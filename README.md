# Agent Studio

A full-stack web app for creating and running multiple AI agents. Built with **Node.js + Express** (backend) and a **no-build vanilla JS** frontend. Works with any OpenAI-compatible LLM API — OpenAI, OpenRouter, Groq, Together, or a local model via Ollama.

## Features

- **Create unlimited agents** — each with its own name, description, system prompt, model, and temperature.
- **Streaming chat** — talk to any agent one-on-one; replies stream token-by-token. Full conversation history persisted per agent.
- **Crew Run (multi-agent)** — select several agents, set a number of rounds, and they work the same task in sequence. Each agent sees every previous response, so they build on / debate each other. Past crew runs are saved and replayable.
- **Settings panel** — set API base URL, key, and default model in the UI (stored in `data/config.json`).
- **Zero build step** — plain HTML/JS/CSS served by Express. Data persists as JSON files in `data/`.

## Quick start

Requires Node.js >= 18.

```bash
cd agent-studio
npm install      # only dependency: express
npm start        # → http://localhost:3000
```

Then open the app, click **Settings** (gear icon, top right), and set:
- **API Base URL** — e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `https://api.groq.com/openai/v1`, or `http://localhost:11434/v1` for local Ollama.
- **API Key** — your provider key (for Ollama, any string like `ollama` works).
- **Default model** — e.g. `gpt-4o-mini`, `meta-llama/llama-3.1-8b-instruct`, `llama3.1`, etc.

You can also set these via environment variables (see `.env.example`).

## Using it

1. **Chat tab** — pick an agent from the sidebar (three are seeded: Researcher, Writer, Critic), type a message, press Enter. Click **+ New Agent** to create your own, or **Edit agent** to modify the selected one.
2. **Crew Run tab** — click agent chips to select them (in order), choose rounds, write a task, hit **Run crew**. Each agent's output streams into its own card. Past runs are listed below and can be re-opened.

## API

| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/api/config` | LLM config (baseURL, apiKey, defaultModel) |
| GET/POST | `/api/agents` | List / create agents |
| GET/PUT/DELETE | `/api/agents/:id` | Read / update / delete an agent |
| GET | `/api/conversations?agentId=` | List chats for an agent |
| GET/DELETE | `/api/conversations/:id` | Read / delete a chat |
| POST | `/api/chat` | Send a message, stream reply (SSE) |
| POST | `/api/crew/run` | Run a multi-agent crew (SSE) |
| GET | `/api/crew/runs[/:id]` | List / replay past crew runs |

## Project layout

```
agent-studio/
├── server.js          # Express app + all REST/SSE endpoints
├── lib/
│   ├── store.js       # JSON-file persistence (agents, chats, config, crew runs)
│   ├── llm.js         # OpenAI-compatible streaming client
│   ├── agent.js       # single-agent runner
│   └── crew.js        # multi-agent round-robin orchestration
├── public/            # frontend (index.html, app.js, style.css)
├── data/              # created on first run — your persisted data lives here
└── package.json
```

## Notes

- All data is stored locally in plain JSON files under `data/` — no database needed. Back that folder up to keep your agents and chats.
- An agent with an empty **Model** field falls back to the default model from Settings.
- In Crew mode, each agent receives the task plus all prior responses as context; with many rounds this can get expensive — start with 1 round.

## Deployment

**Docker (recommended):**
```bash
docker compose up -d   # builds and runs on :3000, persists ./data
```
Or build manually: `docker build -t agent-studio . && docker run -p 3000:3000 -v $(pwd)/data:/app/data agent-studio`

**Bare metal / PaaS (Render, Fly.io, Railway):** `npm install && npm start`, set env vars from `.env.example`. Mount `data/` on a persistent volume.

**Behind HTTPS:** put behind Nginx/Caddy/Cloudflare — the app trusts `X-Forwarded-*`. Set `APP_URL` to your public URL.

**Health check:** `GET /healthz` returns `{"status":"ok",...}` — use for load balancers.

**Optional integrations** (all degrade gracefully if unset): Stripe (`STRIPE_*`), SMTP email (`SMTP_*`), admin emails (`ADMIN_EMAILS`).
