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

### Prerequisite: herdr's claude integration

```bash
herdr integration install claude
```

Without it herdr never reports a pane's `agent_status`, so nothing works that
depends on knowing what claude is doing: permission prompts are never seen
(`blocked` never arrives), replies are never read back (they are triggered by the
turn settling), and the session list shows no activity. Install it once per
machine before running the server.

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
                                       ├─ Pane Events — one global pane.updated subscription
                                       ├─ Transcript Readback — ~/.claude/projects/**.jsonl tail
                                       ├─ Native Permission — blocked → screen parse → send_keys
                                       └─ Static file serving (production)
                                              ↓
                                     Claude Code CLI (local) via herdr
```

### Key Architectural Decisions

All recorded in `docs/adr/`. Key decisions:

- **Herdr terminal layer** (ADR-015): herdr socket is the only trunk; C-hybrid concepts carried; the SDK query() path was removed in #25 (see ADR-011's "#25 後現況" section).
- **herdr-native model** (ADR-015 §2026-08-02, #29): the self-built hook pipeline is gone. Replies are read from claude's transcript file and permissions from the pane's own screen, so a session the user started in their own terminal behaves exactly like one cc-mobile launched.
- **Permission flow** (ADR-015 §2026-08-02): herdr reports `blocked` → the server parses the prompt off `pane.read --source detection` → the phone shows the terminal's own options → `pane.send_keys` presses the chosen key. Unanswered after 90s → `esc`, but only on panes cc-mobile launched, and only if a fresh `agent_status` + prompt-fingerprint re-read still match.
- **Zod validation** (ADR-001): Runtime validation on WS messages, single source of truth for types.
- **Zustand + WsService** (ADR-008): Per-session state isolation via Zustand store + WebSocket singleton service.

### WebSocket Protocol

Client→Server: `terminal_create`, `terminal_send`, `terminal_teardown`, `list_terminal_sessions`, `permission`, `interrupt`, `stop_task`, `append_user_message`, `get_server_config`, `set_model`, `set_effort`, `set_env_vars`, `set_permission_mode`, `list_directories`, `reconnect`

`permission` carries `optionId` — the id of one of the options the server parsed
off the terminal's screen. The pre-#29 `allow` boolean is still accepted for one
migration window (`false` → Esc, `true` → the terminal's first option) so a
cached PWA bundle can still answer.

Server→Client: `terminal_created`, `terminal_teardown_result`, `terminal_sessions`, `stream_chunk`, `stream_end`, `session_state`, `permission_request`, `capabilities`, `server_config`, `directory_listing`, `event`, `replay_complete`, `error`

Browsing past conversations is gone since #26: there is no session history,
no listing and no resume — herdr's live sessions are the only sessions there
are.

Since #29 the session key on the wire is herdr's `pane_id`, not a claude uuid: it
exists for every pane and survives a `/clear`. `terminal_sessions` carries
`sessions[]` — one descriptor per claude running **anywhere on the machine**,
including ones the user started in their own terminal — with
`{sessionId, agentSessionValue, cwd, origin, drivable, readable, gated, state?}`.
`gated:false` means that pane's claude runs with no permission gate; it is a
badge, never a lock (the composer stays enabled). `unknownUuids` is gone with the
startup remount scan that produced it; `claudeUuids` mirrors `sessions[].sessionId`
and `states` is pane-keyed.

Refused by the Zod gate: `list_sessions`, `resume_session`, `set_session_title`,
`session_list`, `session_history`, `session_created` (all #26), plus #25's
`new_session`, `send`, `command`, `pty_send`, `get_session_info`,
`session_info`, `result` and the `tmux_*` names `terminal_*` replaced.

Schemas defined in `server/protocol.ts`. Full spec in `cc-mobile.md`.

## Security Constraints

- Permission mode defaults to `"default"` — configurable via `--permission-mode` CLI flag (ADR-003)
- `CC_MOBILE_ALLOWED_ROOTS` env var restricts allowed working directories
- No auth layer on Tailscale (network membership = auth)
- If exposing via Cloudflare Tunnel, auth must be added
