"""
Agent payload building and API communication for Agora ConvoAI
"""

import json
import http.client
import urllib.parse
from collections import OrderedDict
from core.tokens import build_token_with_rtm


def build_auth_header(constants):
    """
    Builds the Authorization header for Agora ConvoAI API calls.

    If AGENT_AUTH_HEADER is set, uses it directly (Basic auth).
    Otherwise generates a v007 token using APP_ID + APP_CERTIFICATE
    and returns 'agora token=<token>' format.
    """
    auth_header = (constants.get("AGENT_AUTH_HEADER") or "").strip()
    if auth_header:
        return auth_header

    # Generate v007 token for auth (use empty channel for API-level auth)
    token_data = build_token_with_rtm("", constants["APP_ID"], constants)
    return f"agora token={token_data['token']}"


def build_tts_config(tts_vendor, constants, query_params=None):
    """
    Builds TTS configuration based on vendor.

    Args:
        tts_vendor: The TTS vendor name
        constants: Dictionary of constants
        query_params: Optional query parameters for overrides

    Returns:
        Dictionary containing TTS configuration
    """
    query_params = query_params or {}

    tts_config = {
        "vendor": tts_vendor
    }

    if tts_vendor == "elevenlabs":
        voice_id = query_params.get('voice_id', constants["TTS_VOICE_ID"])
        if not voice_id:
            raise ValueError("TTS_VOICE_ID is required for ElevenLabs")

        tts_config["params"] = {
            "key": constants["TTS_KEY"],
            "model_id": query_params.get('tts_model', constants["ELEVENLABS_MODEL"]),
            "voice_id": voice_id,
            "stability": float(query_params.get('voice_stability', constants["ELEVENLABS_STABILITY"])),
            "sample_rate": int(query_params.get('sample_rate', constants["TTS_SAMPLE_RATE"]))
        }

    elif tts_vendor == "openai":
        tts_config["params"] = {
            "api_key": constants["TTS_KEY"],
            "model": query_params.get('tts_model', constants["OPENAI_TTS_MODEL"]),
            "voice": query_params.get('voice_id', constants["TTS_VOICE_ID"]),
            "response_format": "pcm",
            "speed": float(query_params.get('voice_speed', constants["TTS_SPEED"]))
        }

    elif tts_vendor == "cartesia":
        tts_config["params"] = {
            "api_key": constants["TTS_KEY"],
            "model_id": query_params.get('tts_model', constants["CARTESIA_MODEL"]),
            "sample_rate": int(query_params.get('sample_rate', constants["TTS_SAMPLE_RATE"])),
            "voice": {
                "mode": "id",
                "id": query_params.get('voice_id', constants["TTS_VOICE_ID"])
            }
        }

    elif tts_vendor == "rime":
        tts_config["params"] = {
            "api_key": constants["TTS_KEY"],
            "speaker": query_params.get('voice_id', constants["TTS_VOICE_ID"]),
            "modelId": query_params.get('rime_model_id', constants["RIME_MODEL_ID"]),
            "lang": query_params.get('rime_lang', constants["RIME_LANG"]),
            "samplingRate": int(query_params.get('rime_sampling_rate', constants["RIME_SAMPLING_RATE"])),
            "speedAlpha": float(query_params.get('rime_speed_alpha', constants["RIME_SPEED_ALPHA"]))
        }
    else:
        raise ValueError(f"Unsupported TTS vendor: {tts_vendor}")

    # Optional: skip_patterns — tells TTS to skip bracketed content
    # Value is comma-separated ints: 1=（）  2=【】  3=()  4=[]  5={}
    skip_patterns_str = query_params.get('tts_skip_patterns') or constants.get("TTS_SKIP_PATTERNS")
    if skip_patterns_str:
        tts_config["skip_patterns"] = [int(x.strip()) for x in skip_patterns_str.split(",") if x.strip()]

    return tts_config


def build_asr_config(asr_vendor, constants, query_params=None):
    """
    Builds ASR configuration based on vendor.

    Args:
        asr_vendor: The ASR vendor name
        constants: Dictionary of constants
        query_params: Optional query parameters for overrides

    Returns:
        Dictionary containing ASR configuration
    """
    query_params = query_params or {}

    asr_config = {
        "vendor": asr_vendor
    }

    if asr_vendor == "ares":
        # Ares is built into Agora, just needs language
        asr_config["language"] = query_params.get('asr_language', constants["ASR_LANGUAGE"])

    elif asr_vendor == "deepgram":
        asr_config["params"] = {
            "key": constants["DEEPGRAM_KEY"],
            "model": query_params.get('deepgram_model', constants["DEEPGRAM_MODEL"]),
            "language": query_params.get('deepgram_language', constants["DEEPGRAM_LANGUAGE"])
        }
    else:
        # Default fallback - just set language
        asr_config["language"] = query_params.get('asr_language', constants["ASR_LANGUAGE"])

    return asr_config


def build_mllm_config(constants, query_params=None):
    """
    Builds MLLM (Multimodal LLM) configuration for Gemini Live or OpenAI Realtime.

    Args:
        constants: Dictionary of constants
        query_params: Optional query parameters for overrides

    Returns:
        Dictionary containing MLLM configuration
    """
    query_params = query_params or {}
    import base64

    # Get adc_credentials_string - can be stringified JSON or base64
    adc_credentials = query_params.get('adc_credentials_string', constants.get("MLLM_ADC_CREDENTIALS_STRING", ""))

    # If it looks like JSON (starts with {), use it directly; otherwise assume base64
    if adc_credentials and not adc_credentials.strip().startswith("{"):
        try:
            adc_credentials = base64.b64decode(adc_credentials).decode('utf-8')
        except Exception:
            # If base64 decode fails, use as-is
            pass

    vendor = query_params.get('mllm_vendor', constants.get("MLLM_VENDOR", "vertexai"))
    prompt = query_params.get('prompt', constants.get("DEFAULT_PROMPT", "You are a friendly assistant."))

    # Build vendor-specific params
    params = {
        "model": query_params.get('mllm_model', constants.get("MLLM_MODEL", "gemini-live-2.5-flash-preview-native-audio-09-2025")),
        "voice": query_params.get('mllm_voice', constants.get("MLLM_VOICE", "Charon")),
        "instructions": prompt,
    }

    if vendor == "openai":
        # OpenAI Realtime specific params
        params["input_audio_transcription"] = {
            "language": constants.get("ASR_LANGUAGE", "en-US")[:2],
            "model": "gpt-4o-mini-transcribe",
        }
    else:
        # VertexAI/Gemini specific params
        params["temperature"] = 0.9
        params["max_tokens"] = 3000
        params["affective_dialog"] = False
        params["proactive_audio"] = False
        params["adc_credentials_string"] = adc_credentials
        params["project_id"] = query_params.get('mllm_project_id', constants.get("MLLM_PROJECT_ID", ""))
        params["location"] = query_params.get('mllm_location', constants.get("MLLM_LOCATION", "us-central1"))
        params["transcribe_agent"] = query_params.get('mllm_transcribe_agent', constants.get("MLLM_TRANSCRIBE_AGENT", "true")).lower() == "true"
        params["transcribe_user"] = query_params.get('mllm_transcribe_user', constants.get("MLLM_TRANSCRIBE_USER", "true")).lower() == "true"

    mllm_config = {
        "predefined_tools": ["_publish_message"],
        "vendor": vendor,
        "url": query_params.get('mllm_url') or constants.get("MLLM_URL") or "",
        "api_key": constants.get("MLLM_API_KEY") or "",
        "messages": [
            {
                "role": "system",
                "content": prompt
            }
        ],
        "params": params,
        "output_modalities": ["text", "audio"] if vendor == "openai" else ["audio"],
        "max_history": 20,
        "greeting_message": query_params.get('greeting', constants.get("DEFAULT_GREETING", "Hey There Sir")),
        "failure_message": query_params.get('failure_message', constants.get("DEFAULT_FAILURE_MESSAGE", "Something went wrong"))
    }

    # Add style only when set (OpenAI requires it)
    style = constants.get("MLLM_STYLE")
    if style:
        mllm_config["style"] = style

    return mllm_config


def build_mcp_servers(constants, query_params=None, channel=None):
    """
    Parses MCP_SERVERS JSON config and returns list of MCP server configs.

    Args:
        constants: Dictionary of constants
        query_params: Optional query parameters for overrides
        channel: Channel name used as user_id for per-user MCP endpoints

    Returns:
        List of MCP server config dicts, or None if not configured
    """
    query_params = query_params or {}
    mcp_json = query_params.get('mcp_servers', constants.get("MCP_SERVERS"))
    if not mcp_json:
        return None

    servers = json.loads(mcp_json) if isinstance(mcp_json, str) else mcp_json
    if not servers:
        return None

    # Inject user_id (channel name) into endpoint paths for per-user partitioning
    user_id = query_params.get('mcp_user_id', channel) if query_params else channel
    if user_id:
        for server in servers:
            endpoint = server.get("endpoint", "").rstrip("/")
            server["endpoint"] = f"{endpoint}/{user_id}"

    return servers


def build_avatar_config(avatar_vendor, constants, channel, agent_video_token, query_params=None):
    """
    Builds avatar configuration based on vendor.

    Args:
        avatar_vendor: The avatar vendor name (heygen, anam, or None)
        constants: Dictionary of constants
        channel: The channel name
        agent_video_token: Token for the avatar video stream
        query_params: Optional query parameters for overrides

    Returns:
        Dictionary containing avatar configuration, or None if no vendor
    """
    if not avatar_vendor:
        return None

    query_params = query_params or {}

    # Validate generic avatar credentials
    if not constants.get("AVATAR_API_KEY"):
        raise ValueError(
            f"AVATAR_API_KEY is required when AVATAR_VENDOR={avatar_vendor}. "
            f"Set AVATAR_API_KEY in your .env file."
        )
    if not constants.get("AVATAR_ID"):
        raise ValueError(
            f"AVATAR_ID is required when AVATAR_VENDOR={avatar_vendor}. "
            f"Set AVATAR_ID in your .env file."
        )

    if avatar_vendor == "heygen":
        # For HeyGen, agora_token is the APP_ID if no real token
        agora_token_value = agent_video_token if agent_video_token else constants["APP_ID"]

        return {
            "vendor": "heygen",
            "enable": True,
            "params": {
                "api_key": constants["AVATAR_API_KEY"],
                "quality": query_params.get('heygen_quality', constants["HEYGEN_QUALITY"]),
                "agora_uid": constants["AGENT_VIDEO_UID"],
                "agora_token": agora_token_value,
                "avatar_id": constants["AVATAR_ID"],
                "disable_idle_timeout": False,
                "activity_idle_timeout": int(query_params.get('heygen_idle_timeout', constants["HEYGEN_ACTIVITY_IDLE_TIMEOUT"]))
            }
        }
    elif avatar_vendor == "anam":
        # For Anam, agora_token is the APP_ID if no real token
        agora_token_value = agent_video_token if agent_video_token else constants["APP_ID"]

        return {
            "vendor": "anam",
            "enable": True,
            "params": {
                "api_key": constants["AVATAR_API_KEY"],
                "agora_uid": constants["AGENT_VIDEO_UID"],
                "agora_token": agora_token_value,
                "avatar_id": constants["AVATAR_ID"],
                "sample_rate": 24000
            }
        }
    else:
        # Placeholder for future avatar vendors
        return None


def _create_pipeline_payload(channel, pipeline_id, constants, query_params=None, agent_video_token=None):
    """
    Creates a minimal agent payload for Agent Builder pipeline mode.

    When pipeline_id is set, Agora resolves all STT/TTS/LLM/avatar configs
    from the pipeline — only connection properties are needed.

    Args:
        channel: The channel name
        pipeline_id: Agent Builder pipeline ID
        constants: Dictionary of constants
        query_params: Optional query parameters for overrides
        agent_video_token: Token for avatar video (if avatar enabled)

    Returns:
        OrderedDict containing the minimal pipeline payload
    """
    query_params = query_params or {}

    # Generate agent token
    agent_rtm_uid = f"{constants['AGENT_UID']}-{channel}"
    if constants.get("APP_CERTIFICATE"):
        agent_token_info = build_token_with_rtm(
            channel, constants["AGENT_UID"], constants, rtm_uid=agent_rtm_uid
        )
        agent_channel_token = agent_token_info["token"]
    else:
        agent_channel_token = constants["APP_ID"]

    # Avatar mode needs explicit user UID
    avatar_vendor = constants.get("AVATAR_VENDOR")
    remote_rtc_uids = [constants["USER_UID"]] if avatar_vendor else ["*"]

    properties = OrderedDict([
        ("channel", channel),
        ("token", agent_channel_token),
        ("agent_rtc_uid", constants["AGENT_UID"]),
        ("agent_rtm_uid", agent_rtm_uid),
        ("remote_rtc_uids", remote_rtc_uids),
        ("advanced_features", {"enable_rtm": True}),
        ("enable_string_uid", False),
    ])

    # Custom LLM: when LLM_VENDOR=custom and LLM_URL are set,
    # supply a full properties.llm block (same as non-pipeline mode).
    # Pipeline provides TTS/ASR/AIVAD; we provide the LLM directly.
    llm_vendor = constants.get("LLM_VENDOR")
    llm_url = constants.get("LLM_URL")
    if llm_vendor == "custom" and llm_url:
        prompt = query_params.get('prompt', constants.get("DEFAULT_PROMPT", "You are a friendly assistant."))
        greeting = query_params.get('greeting', constants.get("DEFAULT_GREETING", "hi there"))
        failure_message = constants.get("DEFAULT_FAILURE_MESSAGE", "Sorry, something went wrong")
        max_history = int(constants.get("MAX_HISTORY", "32"))

        # Generate subscriber token (UID 5000) for audio capture
        sub_token_info = build_token_with_rtm(channel, "5000", constants)
        # Generate RTM token (UID 5001) for messaging
        llm_rtm_uid = f"5001-{channel}"
        rtm_token_info = build_token_with_rtm(channel, "5001", constants, rtm_uid=llm_rtm_uid)

        properties["llm"] = {
            "url": llm_url,
            "api_key": constants.get("LLM_API_KEY", ""),
            "vendor": "custom",
            "style": constants.get("LLM_STYLE", "openai"),
            "system_messages": [{"role": "system", "content": prompt}],
            "greeting_message": greeting,
            "failure_message": failure_message,
            "max_history": max_history,
            "params": {
                "model": constants.get("LLM_MODEL", "gpt-4o-mini"),
                "channel": channel,
                "app_id": constants["APP_ID"],
                "user_uid": constants["USER_UID"],
                "agent_uid": constants["AGENT_UID"],
                "subscriber_token": sub_token_info["token"],
                "rtm_token": rtm_token_info["token"],
                "rtm_uid": llm_rtm_uid,
            },
        }
    else:
        # No custom LLM — allow query param overrides for prompt and greeting only.
        # asr_language and enable_aivad are NOT included — the pipeline owns those.
        prompt = query_params.get('prompt')
        greeting = query_params.get('greeting')

        overrides = {}
        if prompt:
            overrides["llm"] = {"system_messages": [{"role": "system", "content": prompt}]}
        if greeting:
            overrides["llm"] = overrides.get("llm", {})
            overrides["llm"]["greeting_message"] = greeting

        if overrides:
            properties["overrides"] = overrides

    # Enable transcript delivery so clients receive agent messages via RTM
    properties["parameters"] = {
        "transcript": {
            "enable": True,
            "protocol_version": "v2",
            "enable_words": False
        },
        "enable_dump": True,
    }

    # Add avatar config if needed (avatar isn't part of pipeline)
    if avatar_vendor:
        avatar_config = build_avatar_config(
            avatar_vendor, constants, channel,
            agent_video_token if agent_video_token else "",
            query_params
        )
        if avatar_config:
            properties["avatar"] = avatar_config

    payload = OrderedDict([
        ("name", channel),
        ("pipeline_id", pipeline_id),
        ("properties", properties)
    ])

    return payload


def create_agent_payload(channel, constants, query_params=None, agent_video_token=None):
    """
    Creates the complete agent payload for Agora ConvoAI.

    Args:
        channel: The channel name
        constants: Dictionary of constants
        query_params: Optional query parameters for overrides
        agent_video_token: Token for avatar video (if avatar enabled)

    Returns:
        OrderedDict containing the complete agent payload
    """
    query_params = query_params or {}

    # Check for pipeline mode (Agent Builder)
    pipeline_id = query_params.get('pipeline_id') or constants.get("PIPELINE_ID")
    if pipeline_id:
        return _create_pipeline_payload(channel, pipeline_id, constants, query_params, agent_video_token)

    # Check if MLLM mode is enabled
    enable_mllm = query_params.get('enable_mllm', constants.get("ENABLE_MLLM", "false")).lower() == "true"

    # Get other settings
    idle_timeout = int(query_params.get('idle_timeout', constants["IDLE_TIMEOUT"]))
    vad_silence_duration_raw = constants.get("VAD_SILENCE_DURATION_MS", "").strip()
    vad_silence_duration = int(vad_silence_duration_raw) if vad_silence_duration_raw else None
    enable_aivad = query_params.get('enable_aivad', constants["ENABLE_AIVAD"]).lower() == "true"

    # MLLM mode: Build mllm config, skip TTS/LLM
    if enable_mllm:
        mllm_config = build_mllm_config(constants, query_params)

        # Get ASR vendor for MLLM mode (still needed)
        asr_vendor = query_params.get('asr_vendor', constants.get("ASR_VENDOR", "ares"))
        asr_config = build_asr_config(asr_vendor, constants, query_params)

        tts_config = None
        llm_config = None
    else:
        # Standard mode: Build TTS and LLM configs
        tts_vendor = query_params.get('tts_vendor', constants.get("TTS_VENDOR"))
        asr_vendor = query_params.get('asr_vendor', constants.get("ASR_VENDOR"))

        if not tts_vendor:
            raise ValueError("TTS_VENDOR must be set via environment variable or query parameter")

        # Build TTS configuration
        tts_config = build_tts_config(tts_vendor, constants, query_params)

        # Build ASR configuration
        asr_config = build_asr_config(asr_vendor, constants, query_params)

        # Get LLM parameters
        llm_url = query_params.get('llm_url', constants["LLM_URL"])
        llm_api_key = query_params.get('llm_api_key', constants["LLM_API_KEY"])
        llm_model = query_params.get('llm_model', constants["LLM_MODEL"])

        # Get prompt and messages
        prompt = query_params.get('prompt', constants["DEFAULT_PROMPT"])
        greeting = query_params.get('greeting', constants["DEFAULT_GREETING"])
        failure_message = query_params.get('failure_message', constants["DEFAULT_FAILURE_MESSAGE"])
        max_history = int(query_params.get('max_history', constants["MAX_HISTORY"]))

        # Get Custom LLM parameters
        llm_style = query_params.get('llm_style', constants.get("LLM_STYLE", "openai"))
        llm_vendor = query_params.get('llm_vendor', constants.get("LLM_VENDOR"))
        greeting_mode = query_params.get('greeting_mode', constants.get("GREETING_MODE"))

        # Build LLM configuration
        llm_config = {
            "url": llm_url,
            "api_key": llm_api_key,
            "system_messages": [
                {
                    "role": "system",
                    "content": prompt
                }
            ],
            "greeting_message": greeting,
            "failure_message": failure_message,
            "max_history": max_history,
            "params": {
                "model": llm_model
            },
            "style": llm_style
        }

        # Optional: vendor field (e.g., "custom" adds turn_id + timestamp to requests)
        if llm_vendor:
            llm_config["vendor"] = llm_vendor
            # RTC params for custom LLM servers (audio subscribers, etc.)
            if llm_vendor == "custom":
                llm_config["params"]["channel"] = channel
                llm_config["params"]["app_id"] = constants["APP_ID"]
                llm_config["params"]["user_uid"] = constants["USER_UID"]
                llm_config["params"]["agent_uid"] = constants["AGENT_UID"]
                sub_token_info = build_token_with_rtm(channel, "5000", constants)
                llm_config["params"]["subscriber_token"] = sub_token_info["token"]
                llm_rtm_uid = f"5001-{channel}"
                rtm_token_info = build_token_with_rtm(channel, "5001", constants, rtm_uid=llm_rtm_uid)
                llm_config["params"]["rtm_token"] = rtm_token_info["token"]
                llm_config["params"]["rtm_uid"] = llm_rtm_uid
                # Pass integration API keys to custom LLM if configured
                thymia_api_key = constants.get("THYMIA_API_KEY")
                if thymia_api_key:
                    llm_config["params"]["thymia_api_key"] = thymia_api_key

        # Optional: greeting behavior configuration
        if greeting_mode:
            llm_config["greeting_configs"] = {"mode": greeting_mode}

        # Optional: input modalities (e.g., ["text", "image"] for vision-capable LLMs)
        input_modalities = constants.get("LLM_INPUT_MODALITIES")
        if input_modalities:
            llm_config["input_modalities"] = [m.strip() for m in input_modalities.split(",")]

        mllm_config = None

    # Build MCP servers config (works in standard LLM mode)
    mcp_servers = build_mcp_servers(constants, query_params, channel=channel)
    if mcp_servers and llm_config:
        llm_config["mcp_servers"] = mcp_servers
        print(f"🔧 MCP: {len(mcp_servers)} server(s) configured: {[s.get('name') for s in mcp_servers]}")

    # Get avatar settings early to determine remote_rtc_uids and token
    avatar_vendor = constants.get("AVATAR_VENDOR")

    # Generate agent token with RTC UID for channel join and RTM UID for messaging
    agent_rtm_uid = f"{constants['AGENT_UID']}-{channel}"
    if constants.get("APP_CERTIFICATE"):
        agent_token_info = build_token_with_rtm(
            channel, constants["AGENT_UID"], constants, rtm_uid=agent_rtm_uid
        )
        agent_channel_token = agent_token_info["token"]
    else:
        agent_channel_token = constants["APP_ID"]

    # When avatar is enabled, can't use wildcard "*" for remote_rtc_uids
    # Must specify exact user UID
    remote_rtc_uids = [constants["USER_UID"]] if avatar_vendor else ["*"]

    # Build advanced_features
    enable_sal = query_params.get('enable_sal', constants.get("ENABLE_SAL", "false")).lower() == "true"
    advanced_features = {
        "enable_rtm": True,
    }
    if enable_sal:
        advanced_features["enable_sal"] = True
    if enable_mllm:
        advanced_features["enable_mllm"] = True
        advanced_features["enable_tools"] = False
    elif mcp_servers:
        advanced_features["enable_tools"] = True

    # Build properties
    properties = OrderedDict([
        ("channel", channel),
        ("token", agent_channel_token),
        ("agent_rtc_uid", constants["AGENT_UID"]),
        ("agent_rtm_uid", f"{constants['AGENT_UID']}-{channel}"),
        ("remote_rtc_uids", remote_rtc_uids),
        ("advanced_features", advanced_features),
        ("enable_string_uid", False),
        ("idle_timeout", idle_timeout),
    ])

    # Add mllm or llm configuration
    if enable_mllm:
        properties["mllm"] = mllm_config
    else:
        properties["llm"] = llm_config

    # Add ASR configuration
    properties["asr"] = asr_config

    # Add TTS configuration (only in non-MLLM mode)
    if not enable_mllm:
        properties["tts"] = tts_config

    # Build turn_detection config
    # Use semantic end-of-speech when AIVAD was enabled (replaces deprecated enable_aivad)
    end_of_speech_mode = "semantic" if enable_aivad else "vad"
    turn_detection_config = {
        "end_of_speech": {
            "mode": end_of_speech_mode
        }
    }
    # Add VAD silence_duration_ms only if explicitly set in profile .env
    if vad_silence_duration is not None:
        turn_detection_config["end_of_speech"]["vad_config"] = {
            "silence_duration_ms": vad_silence_duration
        }

    if enable_mllm:
        properties["turn_detection"] = {
            "mode": query_params.get('turn_detection_type') or constants.get("TURN_DETECTION_TYPE") or "server_vad",
            "config": turn_detection_config
        }
    else:
        properties["turn_detection"] = {
            "config": turn_detection_config
        }

    # Build parameters
    enable_audio_chorus = constants.get("ENABLE_AUDIO_CHORUS", "false").lower() == "true"
    if not enable_mllm:
        parameters = {
            "transcript": {
                "enable": True,
                "protocol_version": "v2",
                "enable_words": False
            },
            "enable_dump": True,
        }
    else:
        parameters = {
            "enable_dump": True,
        }
    if enable_audio_chorus:
        parameters["audio_scenario"] = "chorus"
    properties["parameters"] = parameters

    # Add avatar configuration if vendor is set
    if avatar_vendor:
        avatar_config = build_avatar_config(
            avatar_vendor,
            constants,
            channel,
            agent_video_token if agent_video_token else "",
            query_params
        )
        if avatar_config:
            properties["avatar"] = avatar_config

    # Build the complete payload
    payload = OrderedDict([
        ("name", channel),
        ("properties", properties)
    ])

    return payload


def send_agent_to_channel(channel, agent_payload, constants):
    """
    Sends an agent to the specified Agora RTC channel by calling the REST API.

    Args:
        channel: The channel name
        agent_payload: The complete agent payload to send
        constants: Dictionary of constants

    Returns:
        Dictionary with the status code, response body, and success flag
    """
    # Use regular endpoint
    agent_api_url = f"{constants['AGENT_ENDPOINT']}/{constants['APP_ID']}/join"
    auth_header = build_auth_header(constants)

    url_parts = urllib.parse.urlparse(agent_api_url)
    host = url_parts.netloc
    path = url_parts.path

    conn = http.client.HTTPSConnection(host, timeout=30)

    headers = {
        "Content-Type": "application/json",
        "Authorization": auth_header
    }

    payload_json = json.dumps(agent_payload, indent=2)

    print(f"Sending agent to Agora ConvoAI:")
    print(f"URL: {agent_api_url}")
    advanced = agent_payload.get('properties', {}).get('advanced_features')
    if advanced:
        print(f"🔧 enable_rtm: {advanced.get('enable_rtm')}")
    else:
        print(f"🔧 pipeline mode (no advanced_features)")

    # Optional curl dump (disabled by default to avoid exposing API keys)
    enable_curl_dump = constants.get("ENABLE_CURL_DUMP", "false").lower() == "true"

    if enable_curl_dump:
        # Build header arguments for curl from the headers dict
        header_args = ""
        for header_name, header_value in headers.items():
            header_args += f"  -H '{header_name}: {header_value}' \\\n"

        # Print equivalent curl command for debugging
        payload_compact = json.dumps(agent_payload)
        curl_cmd = f"curl -X POST '{agent_api_url}' \\\n{header_args}  -d '{payload_compact}'"
        print(f"\n📋 Equivalent curl command:\n{curl_cmd}\n")

        # Write curl command to file with timestamp and profile name
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        profile_name = constants.get("PROFILE_NAME", "default")
        curl_file_path = f"/tmp/agora_curl_{profile_name}_{timestamp}.sh"

        # Write prettified version to file
        payload_pretty = json.dumps(agent_payload, indent=2)
        curl_file_content = f"""#!/bin/bash
# Agora ConvoAI Request
# Timestamp: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
# Channel: {channel}

curl -X POST '{agent_api_url}' \\
{header_args}  -d '{payload_pretty}'
"""

        with open(curl_file_path, 'w') as f:
            f.write(curl_file_content)

        print(f"📝 Curl command saved to: {curl_file_path}")

    print(f"Payload: {payload_json}")

    conn.request("POST", path, payload_json, headers)

    response = conn.getresponse()
    status_code = response.status
    response_text = response.read().decode('utf-8')

    print(f"Response status: {status_code}", flush=True)
    print(f"Response body: {response_text}", flush=True)

    conn.close()

    return {
        "status_code": status_code,
        "response": response_text,
        "success": status_code == 200
    }


def hangup_agent(agent_id, constants):
    """
    Sends a hangup request to disconnect the agent.

    Args:
        agent_id: The unique identifier for the agent to hang up
        constants: Dictionary of constants

    Returns:
        Dictionary with the status code, response body, and success flag
    """
    hangup_api_url = f"{constants['AGENT_ENDPOINT']}/{constants['APP_ID']}/agents/{agent_id}/leave"

    url_parts = urllib.parse.urlparse(hangup_api_url)
    host = url_parts.netloc
    path = url_parts.path

    conn = http.client.HTTPSConnection(host, timeout=30)

    headers = {
        "Content-Type": "application/json",
        "Authorization": build_auth_header(constants)
    }

    conn.request("POST", path, "", headers)

    response = conn.getresponse()
    status_code = response.status
    response_text = response.read().decode('utf-8')

    conn.close()

    return {
        "status_code": status_code,
        "response": response_text,
        "success": status_code == 200
    }
