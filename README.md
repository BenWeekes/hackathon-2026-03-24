# AI Wellness Agent — Claude Hackathon at Imperial College

By Ben, Nick, Beejal, Anton, Tan

A real-time AI wellness assistant that combines a video avatar with live voice biomarkers and camera-based physiological measurements. The agent uses both data sources to guide a therapeutic conversation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React + Next.js)                                      │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ Anam Avatar  │  │ Shen.AI WASM │  │ Thymia Voice          │ │
│  │ (video)      │  │ Camera Vitals│  │ Biomarkers            │ │
│  │              │  │ HR, HRV, BP  │  │ Emotions, Wellness,   │ │
│  │              │  │ Stress, RR   │  │ Clinical, Safety      │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │ RTC              │ RTM                   │ RTM         │
└─────────┼──────────────────┼───────────────────────┼─────────────┘
          │                  │                       │
          ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  Agora ConvoAI Engine (cloud)                                   │
│  - Orchestrates agent lifecycle                                 │
│  - Routes audio/video via RTC                                   │
│  - Delivers transcripts via RTM                                 │
│  - Connects to LLM, TTS, ASR providers                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Custom LLM Server (remote)                                     │
│  - Proxies LLM requests (OpenAI GPT)                            │
│  - Thymia module: subscribes to user audio → voice biomarkers   │
│  - Shen module: receives camera vitals via RTM → injects into   │
│    LLM system prompt via Agent Update API                       │
└─────────────────────────────────────────────────────────────────┘
```

**Data flows:**
- **Avatar**: Anam renders a video avatar streamed via Agora RTC
- **Voice Biomarkers (Thymia)**: A server-side Go audio subscriber captures user speech → Thymia API analyses emotions, wellness, clinical indicators → results injected into LLM prompt
- **Camera Vitals (Shen.AI)**: Browser-side WASM SDK analyses user's webcam for heart rate, HRV, stress, breathing rate, blood pressure → published via RTM → injected into LLM prompt
- **LLM**: The wellness assistant references both biomarker streams to guide the conversation

## Prerequisites

- **Node.js >= 20.9.0** (use `nvm use 22`)
- **Python 3.x**

## API Keys Required

| Key | Provider | Used by |
|-----|----------|---------|
| Agora APP_ID + APP_CERTIFICATE | [Agora Console](https://console.agora.io) | Backend |
| OpenAI API Key | [OpenAI](https://platform.openai.com) | Backend (via custom LLM) |
| ElevenLabs TTS Key | [ElevenLabs](https://elevenlabs.io) | Backend |
| Deepgram ASR Key | [Deepgram](https://deepgram.com) | Backend |
| Anam Avatar API Key + Avatar ID | [Anam AI](https://anam.ai) | Backend |
| Thymia API Key | [Thymia](https://thymia.ai) | Backend |
| Shen.AI API Key | [Shen.AI](https://shen.ai) | React client |
| Custom LLM URL | Your deployed server | Backend |

## Setup

### 1. Backend

```bash
cd simple-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-local.txt
cp .env.example .env
# Edit .env — fill in all <your-...> placeholders
python3 -u local_server.py
# Runs on http://localhost:8082
```

### 2. React Client

```bash
cd react-video-client-avatar
nvm use 22
npm install --legacy-peer-deps
cp .env.example .env.local
# Edit .env.local — fill in Shen API key
npm run dev
# Runs on http://localhost:8084
```

### 3. Use It

Open **http://localhost:8084** in your browser. The profile field defaults to `HACK`. Click **Start Call**.

- Grant camera + microphone permissions when prompted
- The Anam avatar appears on the left with Shen camera vitals below it
- Thymia voice biomarkers populate on the right as you speak
- The AI assistant references both data sources in conversation

## Project Structure

```
simple-backend/          Python backend — routes requests to Agora ConvoAI API
  core/
    agent.py             Agent payload builder + Agora API client
    config.py            Profile-based env var loader
    tokens.py            Agora RTC/RTM token generation
  local_server.py        Flask server (port 8082)

react-video-client-avatar/   Next.js React client with video avatar + biometrics
  components/
    VideoAvatarClient.tsx    Main UI — avatar, Shen, Thymia panels side-by-side
  hooks/
    useAgoraVideoClient.ts   RTC/RTM connection management
    useShenai.ts             Shen.AI WASM SDK integration
  public/shenai-sdk/         Shen.AI WASM SDK (~35MB)
```

## Notes

- The backend reads `.env` at startup only — restart after any changes
- The React dev server reads `.env.local` at startup — restart after changes
- The dev script uses `--webpack` (not Turbopack) because Turbopack hangs on the Shen WASM file
- Shen.AI SDK requires SharedArrayBuffer — COOP/COEP headers are configured in `next.config.ts`
