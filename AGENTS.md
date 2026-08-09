# AGENTS.md

This file provides guidance to coding agents (e.g. Codex) when working with code in this repository. It mirrors `CLAUDE.md`; both describe the same project, which integrates with Claude Code.

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
- Prod port and bind are configured in `ecosystem.config.cjs` via `--port 7701 --hostname 127.0.0.1`
- Access over TLS: `https://nick-mac-mini.tail361ef.ts.net/`, via `tailscale serve --bg 7701`

The prod server binds loopback only and is reached through `tailscale serve`,
which terminates TLS for the tailnet (publicly-trusted cert, tailnet-only
reachability — not `tailscale funnel`). This is not decoration: on the plain-http
LAN address the page was **not a secure context**, so `navigator.serviceWorker`
and `crypto.subtle` did not exist and `crypto.randomUUID` threw — the phone's PWA
had no service worker and no push, and the new-session button died in its own
handler. Both entrances existing at once would leave that door open, so the LAN
one is closed rather than merely deprecated.

Note the origin change resets everything keyed to it: `localStorage` (projects,
drafts, session persistence) is per-origin, so the https origin starts empty.

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

- **herdr terminal layer** (ADR-015): herdr socket API is the persistent terminal layer (C-hybrid ownership retained: cc-mobile owns session, desktop takes over via `herdr agent attach`). Single herdr trunk; the SDK query() path was removed in #25; interactive TUI lands in subscription bucket.
- **Permission relay** (ADR-002 / ADR-014): the PreToolUse hook POSTs to the server, which asks the phone and holds the reply. Unanswered after 90s → deny (#24).
- **Zod validation** (ADR-001): Runtime validation on WS messages, single source of truth for types.
- **Zustand + WsService** (ADR-008): Per-session state isolation via Zustand store + WebSocket singleton service.

### WebSocket Protocol

Client→Server: `terminal_create`, `terminal_send`, `terminal_teardown`, `list_terminal_sessions`, `permission`, `interrupt`, `stop_task`, `append_user_message`, `get_server_config`, `list_directories`, `reconnect`, `transcript_page_request`

Server→Client: `terminal_created`, `terminal_teardown_result`, `terminal_sessions`, `stream_chunk`, `stream_end`, `session_state`, `permission_request`, `capabilities`, `server_config`, `directory_listing`, `event`, `replay_complete`, `error`, `transcript_page`

`terminal_create` takes an optional `agentKind` (#31) — a closed enum
(`server/agents/kinds.ts`), unlike the free-string `sessions[].agent`, because
this one is what herdr execs. Absent → claude. Per-kind argv lives in
`registry.ts`'s `argvFor`; `server_config.availableAgents` lists the kinds whose
binary is on `PATH`.

`transcript_page_request` / `transcript_page` are the history pull: one page (50
records, a number the wire never carries) of a **live** session's own transcript,
answered with a bare `ws.send` so it never enters the replay buffer. `before` is
a receipt — `{epoch, seq, recordId}` — re-proved against the file the path
resolves to now; a stale or shifted cursor degrades to the newest page instead of
erroring, and the reply's `epoch` says which file that was. No transcript at all
answers `{code:"transcript_unavailable"}`, never a page with an empty `epoch`.
`stream_chunk.chunk` carries the same `epoch` plus `recordId` and `seq` (the
record's absolute byte offset, the only total order the data supports).

Browsing past conversations is gone since #26: there is no session history,
no listing and no resume — herdr's live sessions are the only sessions there
are. `terminal_sessions` is therefore both the liveness list and the status
bootstrap: it carries an optional `states` map (`claudeUuid` → `idle` |
`running` | `requires_action`) so the phone's first paint after a reload is
correct without waiting for a status event.

`terminal_sessions.sessions[]` carries one descriptor per **agent** running
anywhere on the machine, keyed by herdr's `pane_id` — `{sessionId, agent?,
agentSessionValue, cwd, origin, drivable, readable, gated, state?}`. Since #30
nothing is filtered by kind: every entry `agent.list` returns is listed, and
`agent` names the detected kind ("claude", "omp", …) **verbatim** — no enum, no
normalisation, since herdr's label vocabulary is its own and grows between
versions. **An absent `agent` means herdr has not detected a kind yet; it never
means claude.** It is a snapshot-time value, refreshed only when the client asks
for the list again.

`readable:true` means "there is a transcript key, that kind has a registered
reader (claude and omp since #32), and — for a `path` key — the file exists".
The last check is asymmetric: omp reports its path at launch and writes the file
only on the first turn, so one `access()` is paid there; claude's `id` key would
cost a directory scan per listing and is not checked. Like `gated`, it is a badge
and never a lock: `drivable` stays `true` whatever the kind. `claudeUuids`
mirrors `sessions[].sessionId` — an outdated name kept for cached bundles, since
it now holds pane ids of every kind.

Since #33 claude and omp both enter the permission flow; a pane of any other
known kind does not, and one of unreported kind still does. claude's prompt is
numbered and answered with a digit; omp's (`permission/omp-prompt.ts`) is a
cursor list answered with arrow keys plus Enter, so the keystrokes are a
distance computed against the screen at answer time. omp's `Allow tool: ` marker
also classifies: its extension reports `blocked` for API failures, and a blocked
screen without the marker raises no prompt. `gated` reads each kind's own flag
(`--permission-mode` vs `--approval-mode`), whose defaults point opposite ways —
an unflagged omp is ungated.

Refused by the Zod gate: `set_permission_mode`, `set_model`, `set_effort`,
`set_env_vars` (the agent-settings controls, removed once it was settled that an
agent's mode is its own), `list_sessions`, `resume_session`, `set_session_title`,
`session_list`, `session_history`, `session_created` (all #26), plus #25's
`new_session`, `send`, `command`, `pty_send`, `get_session_info`,
`session_info`, `result` and the `tmux_*` names `terminal_*` replaced.

Schemas defined in `server/protocol.ts`. Full spec in `cc-mobile.md`.

## Security Constraints

- cc-mobile sets no agent settings — no launch flag, no CLI flag, and the four `set_*` messages are refused by the gate (ADR-003 superseded). `gated` discloses, it does not control.
- `CC_MOBILE_ALLOWED_ROOTS` env var restricts allowed working directories
- No auth layer on Tailscale (network membership = auth)
- If exposing via Cloudflare Tunnel, auth must be added
