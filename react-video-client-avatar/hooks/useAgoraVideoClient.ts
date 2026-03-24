/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import AgoraRTC, {
  IMicrophoneAudioTrack,
  IAgoraRTCRemoteUser,
  IAgoraRTCClient,
} from "agora-rtc-sdk-ng";
import AgoraRTM from "agora-rtm";
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  TurnStatus,
  TranscriptHelperMode,
  ChatMessageType,
  ChatMessagePriority,
  type TranscriptHelperItem,
} from "agora-agent-client-toolkit";
import { MicButtonState } from "@agora/agent-ui-kit";

export type VoiceClientConfig = {
  appId: string;
  channel: string;
  token: string | null;
  uid: number;
  rtmUid?: string;
  agentUid?: string;
  agentRtmUid?: string;
  microphoneId?: string;
};

export interface IMessageListItem {
  turn_id: number;
  uid: string;
  text: string;
  status: number;
  timestamp?: number;
}

export function useAgoraVideoClient() {
  const [localAudioTrack, setLocalAudioTrack] =
    useState<IMicrophoneAudioTrack | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [micState, setMicState] = useState<MicButtonState>("idle");
  const [messageList, setMessageList] = useState<IMessageListItem[]>([]);
  const [currentInProgressMessage, setCurrentInProgressMessage] =
    useState<IMessageListItem | null>(null);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [agentUid, setAgentUid] = useState<string | undefined>(undefined);
  const [agentRtmUid, setAgentRtmUid] = useState<string | undefined>(undefined);
  const [remoteAudioTrack, setRemoteAudioTrack] = useState<any>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<any>(null);

  const rtcClientRef = useRef<IAgoraRTCClient | null>(null);
  const rtmClientRef = useRef<InstanceType<typeof AgoraRTM.RTM> | null>(null);
  const voiceAIRef = useRef<AgoraVoiceAI | null>(null);
  const volumeCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Simple fan-out for RTM messages — one Agora addEventListener, many subscribers.
  // Agora RTM may not support multiple addEventListener calls for the same event,
  // so we use a single listener and dispatch to all registered handlers ourselves.
  type RTMHandler = (event: { message: string | Uint8Array }) => void;
  const rtmListenersRef = useRef<Set<RTMHandler>>(new Set());
  const [rtmSource, setRtmSource] = useState<{
    on: (event: string, handler: RTMHandler) => void;
    off: (event: string, handler: RTMHandler) => void;
  } | null>(null);

  // Setup RTC event listeners for both audio and video
  useEffect(() => {
    const rtcClient = rtcClientRef.current;
    if (!rtcClient) return;

    const handleUserPublished = async (
      user: IAgoraRTCRemoteUser,
      mediaType: "audio" | "video",
    ) => {
      await rtcClient.subscribe(user, mediaType);

      if (mediaType === "audio") {
        user.audioTrack?.play();
        setRemoteAudioTrack(user.audioTrack ?? null);
        setIsAgentSpeaking(true);
      } else if (mediaType === "video") {
        setRemoteVideoTrack(user.videoTrack ?? null);
      }
    };

    const handleUserUnpublished = (
      _user: IAgoraRTCRemoteUser,
      mediaType: "audio" | "video",
    ) => {
      if (mediaType === "audio") {
        setIsAgentSpeaking(false);
        setRemoteAudioTrack(null);
      } else if (mediaType === "video") {
        setRemoteVideoTrack(null);
      }
    };

    const handleUserLeft = () => {
      setIsAgentSpeaking(false);
      setRemoteAudioTrack(null);
      setRemoteVideoTrack(null);
    };

    rtcClient.on("user-published", handleUserPublished);
    rtcClient.on("user-unpublished", handleUserUnpublished);
    rtcClient.on("user-left", handleUserLeft);

    return () => {
      rtcClient.off("user-published", handleUserPublished);
      rtcClient.off("user-unpublished", handleUserUnpublished);
      rtcClient.off("user-left", handleUserLeft);
    };
  }, [rtcClientRef.current]);

  // Monitor remote audio volume levels
  useEffect(() => {
    if (!remoteAudioTrack) {
      if (volumeCheckIntervalRef.current) {
        clearInterval(volumeCheckIntervalRef.current);
        volumeCheckIntervalRef.current = null;
      }
      return;
    }

    const volumes: number[] = [];
    volumeCheckIntervalRef.current = setInterval(() => {
      if (
        remoteAudioTrack &&
        typeof remoteAudioTrack.getVolumeLevel === "function"
      ) {
        const volume = remoteAudioTrack.getVolumeLevel();
        volumes.push(volume);
        if (volumes.length > 3) volumes.shift();

        const isAllZero = volumes.length >= 2 && volumes.every((v: number) => v === 0);
        const hasSound = volumes.length >= 2 && volumes.some((v: number) => v > 0);

        if (isAllZero && isAgentSpeaking) {
          setIsAgentSpeaking(false);
        } else if (hasSound && !isAgentSpeaking) {
          setIsAgentSpeaking(true);
        }
      }
    }, 100);

    return () => {
      if (volumeCheckIntervalRef.current) {
        clearInterval(volumeCheckIntervalRef.current);
        volumeCheckIntervalRef.current = null;
      }
    };
  }, [remoteAudioTrack, isAgentSpeaking]);

  const leaveChannel = useCallback(async () => {
    try {
      if (voiceAIRef.current) {
        voiceAIRef.current.unsubscribe();
        voiceAIRef.current.destroy();
        voiceAIRef.current = null;
      }

      if (rtmClientRef.current) {
        await rtmClientRef.current.logout();
        rtmClientRef.current = null;
      }

      if (rtcClientRef.current) {
        await rtcClientRef.current.leave();
        rtcClientRef.current = null;
      }

      rtmListenersRef.current.clear();
      setRtmSource(null);
      setLocalAudioTrack(null);
      setIsConnected(false);
      setMicState("idle");
      setIsAgentSpeaking(false);
      setMessageList([]);
      setCurrentInProgressMessage(null);
      setRemoteVideoTrack(null);
    } catch (error) {
      console.error("Error leaving channel:", error);
    }
  }, []);

  const joinChannel = useCallback(
    async (config: VoiceClientConfig) => {
      if (isConnected) {
        await leaveChannel();
      }

      try {
        // Store agent UIDs from backend
        if (config.agentUid) setAgentUid(config.agentUid);
        if (config.agentRtmUid) setAgentRtmUid(config.agentRtmUid);

        // Create RTC client
        const rtcClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
        rtcClientRef.current = rtcClient;

        // Create RTM client
        const rtmUid = config.rtmUid || `${config.uid}`;
        const rtmClient = new AgoraRTM.RTM(config.appId, rtmUid);
        rtmClientRef.current = rtmClient;

        // Initialize AgoraVoiceAI
        const voiceAI = await AgoraVoiceAI.init({
          rtcEngine: rtcClient,
          rtmConfig: { rtmEngine: rtmClient },
          renderMode: TranscriptHelperMode.AUTO,
          enableLog: false,
        });

        // Listen to transcript updates
        voiceAI.on(
          AgoraVoiceAIEvents.TRANSCRIPT_UPDATED,
          (messages: TranscriptHelperItem[]) => {
            const convertedMessages = messages.map((m) => ({
              turn_id: m.turn_id,
              uid: m.uid,
              text: m.text,
              status: m.status,
              timestamp: m.timestamp,
            }));

            const completedMessages = convertedMessages
              .filter((msg) => msg.status !== TurnStatus.IN_PROGRESS)
              .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

            const inProgress = convertedMessages.find(
              (msg) => msg.status === TurnStatus.IN_PROGRESS,
            );

            setMessageList(completedMessages);
            setCurrentInProgressMessage(inProgress || null);
          },
        );

        voiceAIRef.current = voiceAI;

        // Login RTM, subscribe to channel for server-pushed messages (e.g. Thymia biomarkers),
        // and join RTC channel
        await rtmClient.login({ token: config.token ?? undefined });
        await rtmClient.subscribe(config.channel, { withMessage: true, withPresence: false });

        // Single RTM message listener — fans out to all registered handlers.
        // Also logs incoming messages for debugging.
        rtmClient.addEventListener("message", (event: any) => {
          try {
            let raw: string;
            if (typeof event.message === "string") {
              raw = event.message;
            } else if (event.message instanceof Uint8Array) {
              raw = new TextDecoder().decode(event.message);
            } else {
              return;
            }
            const parsed = JSON.parse(raw);
            console.log("[RTM]", parsed.object, "len:", raw.length);
          } catch {
            // skip
          }
          // Dispatch to all registered subscribers
          for (const handler of rtmListenersRef.current) {
            try {
              handler(event);
            } catch {
              // skip
            }
          }
        });

        // Create the RTMEventSource that hooks can subscribe to
        setRtmSource({
          on: (_event: string, handler: RTMHandler) => {
            rtmListenersRef.current.add(handler);
          },
          off: (_event: string, handler: RTMHandler) => {
            rtmListenersRef.current.delete(handler);
          },
        });
        await rtcClient.join(
          config.appId,
          config.channel,
          config.token,
          config.uid,
        );

        // Create and publish audio track
        const audioTrack = await AgoraRTC.createMicrophoneAudioTrack({
          encoderConfig: "high_quality_stereo",
          AEC: true,
          ANS: true,
          AGC: true,
          ...(config.microphoneId
            ? { microphoneId: config.microphoneId }
            : {}),
        });
        await rtcClient.publish([audioTrack]);

        // Subscribe to AI messages on the channel
        voiceAI.subscribeMessage(config.channel);

        setLocalAudioTrack(audioTrack);
        setIsConnected(true);
        setMicState("listening");
      } catch (error) {
        console.error("Error joining channel:", error);
        throw error;
      }
    },
    [isConnected, leaveChannel],
  );

  const toggleMute = useCallback(async () => {
    const track = localAudioTrack;
    if (!track) return;

    try {
      await track.setEnabled(isMuted);
      setIsMuted(!isMuted);
      setMicState(!isMuted ? "idle" : "listening");
    } catch (error) {
      console.error("Error toggling mute:", error);
    }
  }, [isMuted, localAudioTrack]);

  const sendMessage = useCallback(
    async (message: string, targetUid?: string) => {
      const voiceAI = voiceAIRef.current;
      if (!voiceAI) {
        console.error("Cannot send message: AgoraVoiceAI not initialized");
        return false;
      }

      const uid = targetUid || agentRtmUid;
      if (!uid) {
        console.error("Cannot send message: no agent RTM UID available");
        return false;
      }

      try {
        await voiceAI.chat(uid, {
          messageType: ChatMessageType.TEXT,
          text: message,
          priority: ChatMessagePriority.INTERRUPTED,
          responseInterruptable: true,
        });
        return true;
      } catch (error) {
        console.error("Error sending message:", error);
        return false;
      }
    },
    [agentRtmUid],
  );

  return {
    isConnected,
    isMuted,
    micState,
    messageList,
    currentInProgressMessage,
    isAgentSpeaking,
    localAudioTrack,
    remoteVideoTrack,
    joinChannel,
    leaveChannel,
    toggleMute,
    sendMessage,
    agentUid,
    rtcClientRef,
    rtmClientRef,
    rtmSource,
  };
}
