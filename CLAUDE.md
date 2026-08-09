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

Client→Server: `terminal_create`, `terminal_send`, `terminal_teardown`, `list_terminal_sessions`, `permission`, `interrupt`, `stop_task`, `append_user_message`, `get_server_config`, `list_directories`, `reconnect`, `transcript_page_request`

`permission` carries `optionId` — the id of one of the options the server parsed
off the terminal's screen. The pre-#29 `allow` boolean is still accepted for one
migration window (`false` → Esc, `true` → the terminal's first option) so a
cached PWA bundle can still answer.

Since #31 `terminal_create` carries an optional `agentKind` naming which agent to
start (`server/agents/kinds.ts`; absent → `claude`, which is what every bundle
cached before #31 sends). Unlike `sessions[].agent` — herdr's inbound label, a
free string — this one is a closed enum: it becomes the `kind` herdr execs, so an
unlisted value is refused with `invalid_message` before a workspace exists. Each
kind carries its own argv (`registry.ts`'s `argvFor`), and neither kind gets a
gating flag: an agent's permission posture is its own setting, which cc-mobile
stopped deciding (ADR-003 superseded). claude keeps `--session-id` — transcript
naming, not a setting — and omp is handed its transcript path by herdr instead.
`server_config.availableAgents` names the kinds whose binary is on `PATH`, and
is sent only in the `get_server_config` reply.

Server→Client: `terminal_created`, `terminal_teardown_result`, `terminal_sessions`, `stream_chunk`, `stream_end`, `session_state`, `permission_request`, `capabilities`, `server_config`, `directory_listing`, `event`, `replay_complete`, `error`, `transcript_page`

Browsing past conversations is gone since #26: there is no session history,
no listing and no resume — herdr's live sessions are the only sessions there
are. `transcript_page_request` / `transcript_page` are not that coming back:
they read one **live** session's own transcript, and there is still no way to
reach a session that is not running.

The pair is the history pull — the phone asks a live session for one page of its
own backlog, outside the live stream. The reply goes out with a bare `ws.send`,
so it never enters the session's replay buffer: it answers one connection's
question, not the session's. There is no page size on the wire; the server owns
that number (50 records), and the page unit is "records the mapper keeps", not
"records the phone renders", so a page of pure tool plumbing can legitimately
show nothing (ADR-015 M1 keeps that decision on the client).

`before` is the cursor the server last handed back, and it is a receipt: it names
the file (`epoch`) and the record it stops before (`seq` + `recordId`). Both
halves are re-proved against the file the path resolves to *now*, because a
terminal `/clear` rotates it underneath the phone. A cursor from a retired epoch,
one whose offset now holds a different record, or one past EOF degrades to the
newest page of the current file rather than erroring — the reply's own `epoch`
says which file it actually read. `nextBefore: null` means the conversation
starts at this page. A session that is not listed, has no transcript key, or runs
a kind with no registered reader gets `{code:"transcript_unavailable"}` — never a
page with an empty or placeholder `epoch`.

Every `stream_chunk.chunk` now also carries `recordId` (the record's own
`uuid`/`id`, absent when it has neither), `seq` (its absolute byte offset — the
only total order the transcript supports, since timestamps both tie and invert)
and `epoch`. The phone keys messages by `recordId`, orders them by `seq`, and
treats a move between two different non-null `epoch`s — and only that — as the
terminal having reset the conversation.

Since #29 the session key on the wire is herdr's `pane_id`, not a claude uuid: it
exists for every pane and survives a `/clear`. `terminal_sessions` carries
`sessions[]` — one descriptor per **agent** running **anywhere on the machine**,
including ones the user started in their own terminal — with
`{sessionId, agent?, agentSessionValue, cwd, origin, drivable, readable, gated, state?}`.

Since #30 the listing is no longer filtered to claude: every entry herdr's
`agent.list` returns is listed, and `agent` names the kind it detected
("claude", "omp", …) **verbatim** — no enum, no normalisation, since herdr's
label vocabulary is its own and grows between versions. **An absent `agent` means
herdr has not detected a kind yet; it never means claude.** It is a snapshot-time
value — nothing pushes a kind on its own, so a late detection is picked up the
next time the client asks for the list.

`readable:true` means "there is a transcript key, that kind has a registered
reader (claude and omp since #32), **and** — when the key is a path — the file
is actually there". That last check is asymmetric on purpose: herdr gives omp
the path itself (`agent_session.kind === "path"`), and omp reports it at launch
but writes the file only when the first turn starts, so an omp nobody has
spoken to has a key and no file indefinitely (probe 2026-08-06: still absent
after 120s). One `access()` answers that. claude's key is an `id`, and asking
the same question there means the multi-directory scan on every listing for
every pane — not paid, since claude has written the file by the time it has an
id. Like `gated`, `readable` is a badge and never a lock: `drivable` stays
`true` whatever the kind, and the composer stays enabled. `unknownUuids` is gone with the startup remount scan that
produced it; `claudeUuids` mirrors `sessions[].sessionId` (an outdated name kept
for cached bundles — it holds pane ids of every kind now) and `states` is
pane-keyed.

Since #33 two kinds enter the permission flow: claude and omp. A pane whose kind
is known to be anything else does not — `blocked` there is not turned into a
`permission_request`, because on a screen no parser understands even the
Cancel-only fallback would send `esc` as a guess about what that key does. A
pane whose kind herdr has not reported is still forwarded.

The two prompts share nothing but the trigger. claude prints numbered options
and takes the digit; omp prints an unnumbered list with a cursor glyph
(`server/herdr/permission/omp-prompt.ts`) and takes arrow keys plus Enter, so
its answer is a **distance** measured against the screen at answer time, not at
emit time — a human at the terminal may have moved the selection. omp's marker
`Allow tool: ` doubles as the classifier: its extension reports `blocked` for
API failures too, and a blocked screen without that marker is a state, not a
question. `PermissionOption.keystroke` is therefore optional on the wire, absent
for omp; the client answers with `optionId` either way.

`gated` is read in each kind's own vocabulary, and the defaults point opposite
ways: claude with no flag asks, omp with no flag does not (verified live —
a default omp writes files without asking). cc-mobile launches omp with no
approval flag by choice, so the prompts #33 handles are the ones on panes the
user started themselves with `--approval-mode always-ask` / `write`.

Refused by the Zod gate: `set_permission_mode`, `set_model`, `set_effort`,
`set_env_vars` (the agent-settings controls, removed once it was settled that an
agent's mode is its own), `list_sessions`, `resume_session`, `set_session_title`,
`session_list`, `session_history`, `session_created` (all #26), plus #25's
`new_session`, `send`, `command`, `pty_send`, `get_session_info`,
`session_info`, `result` and the `tmux_*` names `terminal_*` replaced.

Schemas defined in `server/protocol.ts`. Full spec in `cc-mobile.md`.

## Background Push (web push for iOS PWA)
- Only panes with origin "self" (cc-mobile launched) trigger `dispatch` to phones.
- Every send attempt is logged to ~/.claude-mobile/push-attempts.jsonl with {ts,kind,host,status,reason} (PushAttemptLog).
- Constant generic payload only; no session/cwd/tool in the push body (traverses APNs).
- VAPID from CC_MOBILE_VAPID_* envs; positive TTL (0→1); 410/404 prunes subscription.
- Subscribe at /api/push/subscribe (dedup by endpoint, allowlist apple, max 10); public key at /api/push/public-key (503 if unset).

## Security Constraints

- cc-mobile sets no agent settings: no `--permission-mode` on launch, no CLI flag, and `set_permission_mode` / `set_model` / `set_effort` / `set_env_vars` are refused by the Zod gate. Each agent runs at its own configured posture (ADR-003 superseded; ADR-015 §2026-08-06). `sessions[].gated` still discloses an ungated pane by reading its argv.
- `CC_MOBILE_ALLOWED_ROOTS` env var restricts allowed working directories
- No auth layer on Tailscale (network membership = auth)
- If exposing via Cloudflare Tunnel, auth must be added
