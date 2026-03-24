"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Settings,
  Phone,
  PhoneOff,
  SendHorizontal,
} from "lucide-react";
import { useAgoraVideoClient } from "@/hooks/useAgoraVideoClient";
import { useAudioVisualization } from "@/hooks/useAudioVisualization";
import { IconButton } from "@agora/agent-ui-kit";
import { Conversation, ConversationContent } from "@agora/agent-ui-kit";
import { Message, MessageContent } from "@agora/agent-ui-kit";
import { Response } from "@agora/agent-ui-kit";
import { AvatarVideoDisplay, LocalVideoPreview } from "@agora/agent-ui-kit";
import { VideoGrid, MobileTabs } from "@agora/agent-ui-kit";
import { AgoraLogo } from "@agora/agent-ui-kit";
import { SettingsDialog, SessionPanel } from "@agora/agent-ui-kit";
import { ShenPanel } from "@agora/agent-ui-kit";
import { ThymiaPanel, useThymia } from "@agora/agent-ui-kit/thymia";
import { useShenai } from "@/hooks/useShenai";
import AgoraRTC from "agora-rtc-sdk-ng";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

const DEFAULT_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8082";
const DEFAULT_PROFILE = process.env.NEXT_PUBLIC_DEFAULT_PROFILE || "VIDEO";
const THYMIA_ENABLED = process.env.NEXT_PUBLIC_ENABLE_THYMIA === "true";
const SHEN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SHEN === "true";
const SHEN_API_KEY = process.env.NEXT_PUBLIC_SHEN_API_KEY || "";

const SENSITIVE_KEYS = [
  "api_key",
  "key",
  "token",
  "adc_credentials_string",
  "subscriber_token",
  "rtm_token",
  "ticket",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function redactSensitiveFields(obj: any): any {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveFields);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.includes(k) && typeof v === "string" && v.length > 6) {
      out[k] = v.slice(0, 6) + "***";
    } else {
      out[k] = redactSensitiveFields(v);
    }
  }
  return out;
}

export function VideoAvatarClient() {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [enableLocalVideo, setEnableLocalVideo] = useState(true);
  const [enableAvatar, setEnableAvatar] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [enableAivad, setEnableAivad] = useState(true);
  const [language, setLanguage] = useState("en-US");
  const [profile, setProfile] = useState("");
  const [prompt, setPrompt] = useState("");
  const [greeting, setGreeting] = useState("");
  const [activeTab, setActiveTab] = useState("video");
  const _conversationRef = useRef<HTMLDivElement>(null);
  const [autoConnect, setAutoConnect] = useState(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const channelRef = useRef<string | null>(null);
  const [selectedMic, setSelectedMic] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("selectedMicId") || ""
      : "",
  );
  const [sessionAgentId, setSessionAgentId] = useState<string | null>(null);
  const [sessionPayload, setSessionPayload] = useState<object | null>(null);

  // Read URL parameters on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlProfile = params.get("profile");
      if (urlProfile) {
        setProfile(urlProfile);
      }
      if (params.get("autoconnect") === "true") {
        setAutoConnect(true);
      }
      const ru = params.get("returnurl");
      if (ru) {
        setReturnUrl(ru);
      }
    }
  }, []);

  const {
    isConnected,
    isMuted,
    micState,
    messageList,
    currentInProgressMessage,
    isAgentSpeaking: _isAgentSpeaking,
    localAudioTrack,
    remoteVideoTrack: avatarVideoTrack,
    joinChannel,
    leaveChannel,
    toggleMute,
    sendMessage,
    agentUid,
    rtcClientRef,
    rtmClientRef,
    rtmSource,
  } = useAgoraVideoClient();

  // Handle mic selection change: persist to localStorage and live-switch if connected
  const handleMicChange = async (deviceId: string) => {
    setSelectedMic(deviceId);
    if (deviceId) {
      localStorage.setItem("selectedMicId", deviceId);
    } else {
      localStorage.removeItem("selectedMicId");
    }
    if (isConnected && localAudioTrack && deviceId) {
      try {
        await localAudioTrack.setDevice(deviceId);
      } catch (err) {
        console.error("Failed to switch microphone:", err);
      }
    }
  };

  // Get audio visualization data (restart on mute/unmute to fix Web Audio API connection)
  const frequencyData = useAudioVisualization(
    localAudioTrack,
    isConnected && !isMuted,
  );

  // Thymia voice biomarker data (opt-in via NEXT_PUBLIC_ENABLE_THYMIA)
  const {
    biomarkers,
    wellness,
    clinical,
    progress: thymiaProgress,
    safety: thymiaSafety,
  } = useThymia(rtmSource, THYMIA_ENABLED && isConnected);

  // Shen.AI camera vitals (opt-in via NEXT_PUBLIC_ENABLE_SHEN)
  // RTM publish function for Shen to push vitals to server
  const shenRtmPublish = useMemo(() => {
    if (!SHEN_ENABLED) return null;
    const rtm = rtmClientRef.current;
    if (!rtm) return null;
    return async (message: string): Promise<boolean> => {
      try {
        const ch = channelRef.current;
        if (!ch) return false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (rtm as any).publish?.(ch, message);
        return true;
      } catch {
        return false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtmClientRef.current]);

  const shenState = useShenai(
    SHEN_ENABLED && isConnected,
    SHEN_API_KEY,
    shenRtmPublish,
    "shen-canvas",
  );

  // Move the shen canvas between desktop/mobile containers based on screen size
  useEffect(() => {
    if (!SHEN_ENABLED || !isConnected) return;

    // Create the canvas once
    let canvas = document.getElementById("shen-canvas") as HTMLCanvasElement;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "shen-canvas";
      canvas.className = "absolute top-1/2 left-1/2 h-full";
      canvas.style.transform = "translate(-50%, -50%) scale(1.8)";
    }

    const moveCanvas = () => {
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      const containerId = isMobile
        ? "shen-container-mobile"
        : "shen-container-desktop";
      const container = document.getElementById(containerId);
      if (container && canvas.parentElement !== container) {
        container.appendChild(canvas);
      }
    };

    moveCanvas();
    const mql = window.matchMedia("(max-width: 767px)");
    mql.addEventListener("change", moveCanvas);
    return () => mql.removeEventListener("change", moveCanvas);
  }, [isConnected]);

  // Local video state - managed directly via AgoraRTC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [localVideoTrack, setLocalVideoTrack] = useState<any>(null);
  const [isLocalVideoActive, setIsLocalVideoActive] = useState(false);

  const handleStart = async () => {
    setIsLoading(true);
    try {
      // Build query params for backend
      const params = new URLSearchParams();

      // Add profile override if provided, otherwise use default "VIDEO" profile
      if (profile.trim()) {
        params.append("profile", profile.trim());
      } else {
        params.append("profile", DEFAULT_PROFILE);
      }

      // Add agent settings
      params.append("enable_aivad", enableAivad.toString());
      params.append("asr_language", language);

      // Add prompt and greeting if provided
      if (prompt.trim()) {
        params.append("prompt", prompt.trim());
      }
      if (greeting.trim()) {
        params.append("greeting", greeting.trim());
      }

      // Phase 1: Get tokens only (don't start agent yet)
      params.append("connect", "false");
      const tokenUrl = `${backendUrl}/start-agent?${params.toString()}`;
      const tokenResponse = await fetch(tokenUrl);

      if (!tokenResponse.ok) {
        throw new Error(`Backend error: ${tokenResponse.statusText}`);
      }

      const data = await tokenResponse.json();

      // Phase 2: Join channel first so RTM is ready for greeting
      channelRef.current = data.channel;
      await joinChannel({
        appId: data.appid,
        channel: data.channel,
        token: data.token || null,
        uid: parseInt(data.uid),
        rtmUid: data.user_rtm_uid, // Channel-scoped RTM UID for multi-session support
        agentUid: data.agent?.uid ? String(data.agent.uid) : undefined,
        agentRtmUid: data.agent_rtm_uid,
        ...(selectedMic ? { microphoneId: selectedMic } : {}),
      });

      // Auto-enable local video if checkbox was checked
      if (enableLocalVideo && rtcClientRef.current) {
        const videoTrack = await AgoraRTC.createCameraVideoTrack({
          encoderConfig: "720p_2",
        });
        await rtcClientRef.current.publish(videoTrack);
        setLocalVideoTrack(videoTrack);
        setIsLocalVideoActive(true);
      }

      // Phase 3: Now start the agent (client is listening for greeting)
      params.delete("connect");
      params.append("channel", data.channel);
      params.append("debug", "true");
      const agentUrl = `${backendUrl}/start-agent?${params.toString()}`;
      const agentResponse = await fetch(agentUrl);

      if (!agentResponse.ok) {
        throw new Error(`Agent start error: ${agentResponse.statusText}`);
      }

      const agentData = await agentResponse.json();

      // Store agent_id from the actual agent response
      if (agentData.agent_response?.response) {
        try {
          const resp =
            typeof agentData.agent_response.response === "string"
              ? JSON.parse(agentData.agent_response.response)
              : agentData.agent_response.response;
          if (resp.agent_id) {
            setAgentId(resp.agent_id);
            setSessionAgentId(resp.agent_id);
          }
        } catch {
          // ignore parse errors
        }
      }

      // Store redacted payload for session panel
      if (agentData.debug?.agent_payload) {
        setSessionPayload(redactSensitiveFields(agentData.debug.agent_payload));
      }
    } catch (error) {
      console.error("Failed to start:", error);
      alert(
        `Failed to start: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-connect after state is committed
  useEffect(() => {
    if (autoConnect) {
      setAutoConnect(false);
      handleStart();
    }
  }, [autoConnect]);

  const handleStop = async () => {
    // Stop and close local video track to release camera hardware
    if (localVideoTrack) {
      localVideoTrack.stop();
      localVideoTrack.close();
      setLocalVideoTrack(null);
      setIsLocalVideoActive(false);
    }
    await leaveChannel();
    setSessionAgentId(null);
    setSessionPayload(null);
    if (returnUrl) {
      window.location.href = returnUrl;
      return;
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !isConnected) return;

    const success = await sendMessage(chatMessage);

    if (success) {
      setChatMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const toggleVideo = async () => {
    if (isLocalVideoActive && localVideoTrack) {
      // Turn off: unpublish, stop, and close to release camera hardware
      if (rtcClientRef.current) {
        await rtcClientRef.current.unpublish(localVideoTrack);
      }
      localVideoTrack.stop();
      localVideoTrack.close();
      setLocalVideoTrack(null);
      setIsLocalVideoActive(false);
    } else if (!isLocalVideoActive && rtcClientRef.current) {
      // Turn on: create new track and publish
      const videoTrack = await AgoraRTC.createCameraVideoTrack({
        encoderConfig: "720p_2",
      });
      await rtcClientRef.current.publish(videoTrack);
      setLocalVideoTrack(videoTrack);
      setIsLocalVideoActive(true);
    }
  };

  // Helper to determine if message is from agent
  // Agent messages have uid matching the agent's RTC UID (provided by backend)
  const isAgentMessage = (uid: string) => {
    return agentUid ? uid === agentUid : false;
  };

  const formatTime = (ts?: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-1 md:py-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C12 2 12.7 4.5 14.1 6.5C15.5 8.5 18 10 18 10C18 10 15.5 10.7 13.5 12.1C11.5 13.5 10 16 10 16C10 16 9.3 13.5 7.9 11.5C6.5 9.5 4 8 4 8C4 8 6.5 7.3 8.5 5.9C10.5 4.5 12 2 12 2Z" fill="#E8734A"/>
              <path d="M18 14C18 14 18.5 15.5 19.5 16.5C20.5 17.5 22 18 22 18C22 18 20.5 18.5 19.5 19.5C18.5 20.5 18 22 18 22C18 22 17.5 20.5 16.5 19.5C15.5 18.5 14 18 14 18C14 18 15.5 17.5 16.5 16.5C17.5 15.5 18 14 18 14Z" fill="#E8734A"/>
            </svg>
            <div>
              <h1 className="text-sm md:text-base font-bold leading-tight hidden md:block">Claude Hackathon at Imperial College</h1>
              <p className="text-[10px] md:text-xs text-muted-foreground leading-tight">By Ben, Nick, Beejal, Anton, Tan</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="cursor-pointer rounded-full p-2 hover:bg-accent transition-colors"
              aria-label="Toggle settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 px-4 py-0 md:py-1 min-h-0 overflow-hidden min-w-0">
        {!isConnected ? (
          /* Connection Form - Centered (same as original) */
          <div className="flex flex-1 items-center justify-center">
            {autoConnect || isLoading ? (
              <p className="text-lg text-muted-foreground animate-pulse">
                Connecting...
              </p>
            ) : (
              <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
                <h2 className="mb-4 text-lg font-semibold">Connect to Agent</h2>
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="backend"
                      className="mb-2 block text-sm font-medium"
                    >
                      Backend URL
                    </label>
                    <input
                      id="backend"
                      type="text"
                      value={backendUrl}
                      onChange={(e) => setBackendUrl(e.target.value)}
                      placeholder={DEFAULT_BACKEND_URL}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="profile"
                      className="mb-2 block text-sm font-medium"
                    >
                      Server Profile
                    </label>
                    <input
                      id="profile"
                      type="text"
                      value={profile}
                      onChange={(e) => setProfile(e.target.value)}
                      placeholder={DEFAULT_PROFILE}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leave empty for default &ldquo;{DEFAULT_PROFILE}&rdquo;
                      profile
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableLocalVideo}
                        onChange={(e) => setEnableLocalVideo(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm font-medium">
                        Enable Local Video
                      </span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enableAvatar}
                        onChange={(e) => setEnableAvatar(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-sm font-medium">Enable Avatar</span>
                    </label>
                  </div>

                  <button
                    onClick={handleStart}
                    disabled={isLoading}
                    className="cursor-pointer w-full rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isLoading ? "Connecting..." : "Start Call"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Connected: Responsive Layout */
          <>
            {/* Desktop Layout - Hidden on mobile */}
            <VideoGrid
              className="hidden md:grid flex-1 min-w-0"
              style={{
                gridTemplateColumns: "2fr 3fr",
                gridTemplateRows: "1fr 1fr",
                gap: "1rem",
              }}
              chat={
                <div className="flex flex-col h-full">
                  {/* Conversation Header */}
                  <div className="border-b p-4 flex-shrink-0 flex items-center justify-between">
                    <h2 className="font-semibold">Conversation</h2>
                    <p className="text-sm text-muted-foreground">
                      {messageList.length} message
                      {messageList.length !== 1 ? "s" : ""}
                    </p>
                  </div>

                  {/* Messages */}
                  <Conversation
                    height=""
                    className="flex-1 min-h-0"
                    style={{ overflow: "auto" }}
                  >
                    <ConversationContent className="gap-3">
                      {messageList.map((msg, idx) => {
                        const isAgent = isAgentMessage(msg.uid);
                        const label = isAgent ? "Agent" : "You";
                        const time = formatTime(msg.timestamp);
                        return (
                          <Message
                            key={`${msg.turn_id}-${msg.uid}-${idx}`}
                            from={isAgent ? "assistant" : "user"}
                            name={time ? `${label}  ${time}` : label}
                          >
                            <MessageContent
                              className={
                                isAgent
                                  ? "px-3 py-2"
                                  : "px-3 py-2 bg-foreground text-background"
                              }
                            >
                              <Response>{msg.text}</Response>
                            </MessageContent>
                          </Message>
                        );
                      })}

                      {/* In-progress message */}
                      {currentInProgressMessage &&
                        (() => {
                          const isAgent = isAgentMessage(
                            currentInProgressMessage.uid,
                          );
                          const label = isAgent ? "Agent" : "You";
                          const time = formatTime(
                            currentInProgressMessage.timestamp,
                          );
                          return (
                            <Message
                              from={isAgent ? "assistant" : "user"}
                              name={time ? `${label}  ${time}` : label}
                            >
                              <MessageContent
                                className={`animate-pulse px-3 py-2 ${isAgent ? "" : "bg-foreground text-background"}`}
                              >
                                <Response>
                                  {currentInProgressMessage.text}
                                </Response>
                              </MessageContent>
                            </Message>
                          );
                        })()}
                    </ConversationContent>
                  </Conversation>

                  {/* Input Box */}
                  <div className="border-t p-4 flex-shrink-0">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatMessage}
                        onChange={(e) => setChatMessage(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message"
                        disabled={!isConnected}
                        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      />
                      <button
                        onClick={handleSendMessage}
                        disabled={!isConnected || !chatMessage.trim()}
                        className="cursor-pointer h-10 w-10 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        <SendHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              }
              avatar={
                <div className="flex flex-col h-full">
                  {/* Avatar Video + optional Thymia/Shen panels */}
                  {THYMIA_ENABLED || SHEN_ENABLED ? (
                    <div className="flex-1 flex min-h-0 gap-3">
                      {/* Left column: Avatar above Video Biometrics (Shen) */}
                      <div className="flex flex-col flex-1 min-h-0 gap-3">
                        <div className="flex-1 flex items-center justify-center bg-muted/20 rounded-lg overflow-hidden min-h-0">
                          <AvatarVideoDisplay
                            videoTrack={avatarVideoTrack}
                            state={
                              avatarVideoTrack
                                ? "connected"
                                : "disconnected"
                            }
                            className="h-full w-full"
                            useMediaStream={true}
                          />
                        </div>
                        {SHEN_ENABLED && (
                          <div className="flex-1 min-h-0 overflow-auto rounded-lg border shen-compact">
                            <ShenPanel
                              shenState={shenState}
                              isConnected={isConnected}
                            />
                          </div>
                        )}
                      </div>
                      {/* Right column: Voice Biometrics (Thymia) */}
                      {THYMIA_ENABLED && (
                        <div className="flex flex-col w-[340px] flex-shrink-0 min-h-0 overflow-auto rounded-lg border thymia-safety-last">
                          <ThymiaPanel
                            biomarkers={biomarkers}
                            wellness={wellness}
                            clinical={clinical}
                            progress={thymiaProgress}
                            safety={thymiaSafety}
                            isConnected={isConnected}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center bg-muted/20 p-2">
                      <AvatarVideoDisplay
                        videoTrack={avatarVideoTrack}
                        state={avatarVideoTrack ? "connected" : "disconnected"}
                        className="h-full w-full"
                        useMediaStream={true}
                      />
                    </div>
                  )}

                  {/* Controls below avatar */}
                  <div className="border-t p-4 flex-shrink-0">
                    <div className="flex gap-3 justify-center">
                      <IconButton
                        shape="square"
                        variant={isMuted ? "standard" : "filled"}
                        size="md"
                        onClick={toggleMute}
                        className={
                          isMuted
                            ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                            : "rounded-lg"
                        }
                      >
                        {isMuted ? (
                          <MicOff className="size-4" />
                        ) : (
                          <Mic className="size-4" />
                        )}
                      </IconButton>
                      <IconButton
                        shape="square"
                        variant={isLocalVideoActive ? "filled" : "standard"}
                        size="md"
                        onClick={toggleVideo}
                        className={
                          !isLocalVideoActive
                            ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                            : "rounded-lg"
                        }
                      >
                        {isLocalVideoActive ? (
                          <Video className="size-4" />
                        ) : (
                          <VideoOff className="size-4" />
                        )}
                      </IconButton>
                      <button
                        onClick={handleStop}
                        className="cursor-pointer flex items-center gap-2 rounded-lg bg-destructive px-5 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                      >
                        <PhoneOff className="h-4 w-4" />
                        End Call
                      </button>
                    </div>
                  </div>
                </div>
              }
              localVideo={
                <div className="h-full flex items-center justify-center p-2">
                  {SHEN_ENABLED ? (
                    <div
                      id="shen-container-desktop"
                      className="relative h-full w-full rounded-lg overflow-hidden bg-black"
                    />
                  ) : (
                    <LocalVideoPreview
                      videoTrack={isLocalVideoActive ? localVideoTrack : null}
                      className="h-full w-full"
                      useMediaStream={true}
                    />
                  )}
                </div>
              }
            />

            {/* Mobile Layout - Hidden on desktop */}
            <div className="flex md:hidden flex-1 flex-col min-h-0 overflow-hidden">
              <MobileTabs
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabs={[
                  {
                    id: "video",
                    label: "Video",
                    content: (
                      <div className="flex flex-col h-full gap-2 p-2">
                        {/* Avatar - 50% */}
                        <div className="flex-1 rounded-lg border bg-card shadow-lg overflow-hidden">
                          <AvatarVideoDisplay
                            videoTrack={avatarVideoTrack}
                            state={
                              avatarVideoTrack ? "connected" : "disconnected"
                            }
                            className="h-full w-full"
                            useMediaStream={true}
                          />
                        </div>

                        {/* Local Video - 50% */}
                        {SHEN_ENABLED ? (
                          <div
                            id="shen-container-mobile"
                            className="relative flex-1 rounded-lg border bg-black shadow-lg overflow-hidden"
                          />
                        ) : (
                          <div className="flex-1 rounded-lg border bg-card shadow-lg overflow-hidden">
                            <LocalVideoPreview
                              videoTrack={
                                isLocalVideoActive ? localVideoTrack : null
                              }
                              className="h-full w-full"
                              useMediaStream={true}
                            />
                          </div>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "chat",
                    label: "Chat",
                    content: (
                      <div className="flex flex-col h-full gap-2 p-2">
                        {/* Avatar - 50% (matches Video tab) */}
                        <div className="flex-[50] rounded-lg border bg-card shadow-lg overflow-hidden">
                          <AvatarVideoDisplay
                            videoTrack={avatarVideoTrack}
                            state={
                              avatarVideoTrack ? "connected" : "disconnected"
                            }
                            className="h-full w-full"
                            useMediaStream={true}
                          />
                        </div>

                        {/* Chat - 50% */}
                        <div className="flex-[50] rounded-lg border bg-card shadow-lg overflow-hidden flex flex-col">
                          {/* Messages */}
                          <Conversation
                            height=""
                            className="flex-1 min-h-0"
                            style={{ overflow: "auto" }}
                          >
                            <ConversationContent className="gap-3">
                              {messageList.map((msg, idx) => {
                                const isAgent = isAgentMessage(msg.uid);
                                const label = isAgent ? "Agent" : "You";
                                const time = formatTime(msg.timestamp);
                                return (
                                  <Message
                                    key={`${msg.turn_id}-${msg.uid}-${idx}`}
                                    from={isAgent ? "assistant" : "user"}
                                    name={time ? `${label}  ${time}` : label}
                                  >
                                    <MessageContent
                                      className={
                                        isAgent
                                          ? "px-3 py-2"
                                          : "px-3 py-2 bg-foreground text-background"
                                      }
                                    >
                                      <Response>{msg.text}</Response>
                                    </MessageContent>
                                  </Message>
                                );
                              })}

                              {/* In-progress message */}
                              {currentInProgressMessage &&
                                (() => {
                                  const isAgent = isAgentMessage(
                                    currentInProgressMessage.uid,
                                  );
                                  const label = isAgent ? "Agent" : "You";
                                  const time = formatTime(
                                    currentInProgressMessage.timestamp,
                                  );
                                  return (
                                    <Message
                                      from={isAgent ? "assistant" : "user"}
                                      name={time ? `${label}  ${time}` : label}
                                    >
                                      <MessageContent
                                        className={`animate-pulse px-3 py-2 ${isAgent ? "" : "bg-foreground text-background"}`}
                                      >
                                        <Response>
                                          {currentInProgressMessage.text}
                                        </Response>
                                      </MessageContent>
                                    </Message>
                                  );
                                })()}
                            </ConversationContent>
                          </Conversation>

                          {/* Input Box */}
                          <div className="border-t p-2 flex-shrink-0">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={chatMessage}
                                onChange={(e) => setChatMessage(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Type a message"
                                disabled={!isConnected}
                                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                              />
                              <button
                                onClick={handleSendMessage}
                                disabled={!isConnected || !chatMessage.trim()}
                                className="cursor-pointer h-10 w-10 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                              >
                                <SendHorizontal className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ),
                  },
                  ...(THYMIA_ENABLED
                    ? [
                        {
                          id: "thymia",
                          label: "Thymia",
                          content: (
                            <ThymiaPanel
                              biomarkers={biomarkers}
                              wellness={wellness}
                              clinical={clinical}
                              progress={thymiaProgress}
                              safety={thymiaSafety}
                              isConnected={isConnected}
                            />
                          ),
                        },
                      ]
                    : []),
                  ...(SHEN_ENABLED
                    ? [
                        {
                          id: "shen",
                          label: "Shen",
                          content: (
                            <ShenPanel
                              shenState={shenState}
                              canvasId="shen-canvas"
                              isConnected={isConnected}
                            />
                          ),
                        },
                      ]
                    : []),
                ]}
              />

              {/* Mobile: Fixed Bottom Controls */}
              <div className="flex gap-3 p-2 border-t bg-card flex-shrink-0 justify-center">
                <IconButton
                  shape="square"
                  variant={isMuted ? "standard" : "filled"}
                  size="md"
                  onClick={toggleMute}
                  className={
                    isMuted
                      ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                      : "rounded-lg"
                  }
                >
                  {isMuted ? (
                    <MicOff className="size-4" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                </IconButton>
                <IconButton
                  shape="square"
                  variant={isLocalVideoActive ? "filled" : "standard"}
                  size="md"
                  onClick={toggleVideo}
                  className={
                    !isLocalVideoActive
                      ? "rounded-lg bg-muted text-destructive hover:bg-muted/80"
                      : "rounded-lg"
                  }
                >
                  {isLocalVideoActive ? (
                    <Video className="size-4" />
                  ) : (
                    <VideoOff className="size-4" />
                  )}
                </IconButton>
                <button
                  onClick={handleStop}
                  className="cursor-pointer flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 min-h-[44px]"
                >
                  <PhoneOff className="h-4 w-4" />
                  End Call
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Settings Dialog */}
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        enableAivad={enableAivad}
        onEnableAivadChange={setEnableAivad}
        language={language}
        onLanguageChange={setLanguage}
        prompt={prompt}
        onPromptChange={setPrompt}
        greeting={greeting}
        onGreetingChange={setGreeting}
        disabled={isConnected}
        selectedMicId={selectedMic}
        onMicChange={handleMicChange}
      >
        <SessionPanel agentId={sessionAgentId} payload={sessionPayload} />
      </SettingsDialog>
    </div>
  );
}
