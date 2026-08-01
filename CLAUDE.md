# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CCMobile — a touch-optimized PWA for interacting with Claude Code from phones/tablets. Runs on the dev machine, accessed via Tailscale or local network. Translates terminal interactions (permission prompts, slash commands, agent invocations) into tap-friendly UI elements.

## Tech Stack

- **Runtime**: Bun
- **Backend**: Elysia (Bun-native server with native WebSocket support)
- **Frontend**: React + Vite (root: `client/`)
- **Claude integration**: herdr socket API (JSON-RPC over unix socket, ~/.config/herdr/herdr.sock; see ADR-015) — the only path; the SDK `query()` driver was removed in #25
- **Validation**: Zod for WebSocket message schemas (see ADR-001)
- **No additional API keys needed** — herdr drives the local `claude` CLI binary

## Commands

```bash
bun install              # Install dependencies
bun run dev:server       # Elysia backend on 0.0.0.0:3001
bunx vite --host         # Vite frontend on :5173 (network accessible)
bun test                 # Run unit tests (bun:test) — hermetic, no daemon needed
bun run test:herdr       # Live e2e against a running herdr daemon + `claude` binary
bun run build            # Production build (Vite outputs to dist/client/)
```

Vite dev server proxies `/ws` and `/api` to Elysia backend on port 3001.

### Port Assignments

| Mode | Service | Port |
|------|---------|------|
| Dev  | Elysia backend | 3001 |
| Dev  | Vite frontend  | 5173 |
| Prod | Elysia (serves everything) | 7701 |

- **Dev**: two processes — Vite (:5173) proxies `/ws` and `/api` to Elysia (:3001)
- **Prod**: single Elysia process serves static files + WebSocket + API on :7701
- Prod port is configured in `ecosystem.config.cjs` via `--port 7701`
- Access via Tailscale IP: `http://100.88.181.24:7701/`

## Architecture

```
Mobile Browser (PWA) ←──WebSocket──→ Elysia Server (dev :3001 / prod :7701)
                                       ├─ WS Plugin (ws.ts) — Zod-validated messages
                                       ├─ Herdr Socket Main Trunk — JSON-RPC over unix socket (ADR-015)
                                       ├─ Permission Relay — PreToolUse hook ↔ WebSocket, 90s deny (ADR-014)
                                       ├─ Response Relay — Stop hook ↔ WebSocket (ADR-011 readback)
                                       └─ Static file serving (production)
                                              ↓
                                     Claude Code CLI (local) via herdr
```

### Key Architectural Decisions

All recorded in `docs/adr/`. Key decisions:

- **Herdr terminal layer** (ADR-015): herdr socket is the only trunk; C-hybrid concepts carried; the SDK query() path was removed in #25 (see ADR-011's "#25 後現況" section).
- **Permission relay** (ADR-002 / ADR-014): the PreToolUse hook POSTs to the server, which asks the phone and holds the reply. Unanswered after 90s → deny (#24).
- **Zod validation** (ADR-001): Runtime validation on WS messages, single source of truth for types.
- **Zustand + WsService** (ADR-008): Per-session state isolation via Zustand store + WebSocket singleton service.

### WebSocket Protocol

Client→Server: `terminal_create`, `terminal_send`, `terminal_teardown`, `list_terminal_sessions`, `permission`, `interrupt`, `stop_task`, `append_user_message`, `get_server_config`, `set_model`, `set_effort`, `set_env_vars`, `set_permission_mode`, `list_sessions`, `resume_session`, `set_session_title`, `list_directories`, `reconnect`

Server→Client: `terminal_created`, `terminal_teardown_result`, `terminal_sessions`, `session_created`, `session_history`, `session_list`, `stream_chunk`, `stream_end`, `session_state`, `permission_request`, `capabilities`, `server_config`, `directory_listing`, `event`, `replay_complete`, `error`

`resume_session` is read-only since #25: it loads a past session's history for
viewing, but that session cannot be continued — start a new terminal session to
keep talking. Deleted in #25 and refused by the Zod gate: `new_session`, `send`,
`command`, `pty_send`, `get_session_info`, `session_info`, `result`, and the
`tmux_*` names `terminal_*` replaced.

Schemas defined in `server/protocol.ts`. Full spec in `cc-mobile.md`.

## Security Constraints

- Permission mode defaults to `"default"` — configurable via `--permission-mode` CLI flag (ADR-003)
- `CC_MOBILE_ALLOWED_ROOTS` env var restricts allowed working directories
- No auth layer on Tailscale (network membership = auth)
- If exposing via Cloudflare Tunnel, auth must be added
