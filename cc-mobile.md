# CCMobile — Plan Document

> Touch-optimized web UI for Claude Code, designed for phones and tablets.
> Not a terminal replacement — a touch translation of terminal interactions.

## Problem

Claude Code is a powerful terminal tool, but mobile/tablet interaction is painful:
- Terminal apps (Termius, Blink) require keyboard-heavy input
- Permission prompts need typing y/n
- Slash commands and agent names are hard to type on touch
- No way to quickly trigger common workflows

## Solution

A PWA that runs on the dev machine, accessible via Tailscale/local network. It connects to Claude Code via the official Agent SDK, translating terminal interactions into touch-friendly UI elements:
- Permission prompts → tap Approve/Deny buttons
- Slash commands → quick action buttons
- Agent invocations → one-tap agent cards
- Text input → optional, with voice input support

## Architecture

```
┌─────────────────┐         ┌───────────────────────────────┐
│  Mobile Browser  │◄──WS──►│  Elysia (Bun-native)          │
│  (PWA)           │         │    ├─ Native WebSocket (.ws()) │
│                  │         │    ├─ Session Manager           │
│  - Chat view     │         │    │   ├─ Session A (cwd: /p1) │
│  - Quick actions │         │    │   └─ Session B (cwd: /p2) │
│  - Permissions   │         │    └─ SDK Bridge               │
│  - Session tabs  │         │        └─ @anthropic-ai/       │
└─────────────────┘         │           claude-agent-sdk      │
                            └───────────────────────────────┘
                                        │
                                        ▼
                              Claude Code CLI (local)
                              Uses existing ANTHROPIC_API_KEY
```

### SDK API Choice — V1 `query()` (see [ADR-007](docs/adr/007-use-v1-query-api.md))

The SDK offers V1 `query()` (stable) and V2 `unstable_v2_createSession()` (preview). This project uses **V1** because V2 does not support the `plugins` option — installed plugins, skills, and agents are not loaded.

V1 uses an async generator pattern with a **resume model** for multi-turn:
1. First turn: `query({ prompt, options })` → iterate generator → close
2. Subsequent turns: `query({ prompt, options: { resume: sessionId } })` → iterate → close

Each turn creates a fresh `query()` with `resume` pointing to the SDK session ID captured from the system init message.

## Dependencies

| Package | Purpose |
|---------|---------|
| `elysia` | Bun-native server — routing, WebSocket (native), schema validation |
| `zod` | Runtime validation for WebSocket messages (see [ADR-001](docs/adr/001-zod-runtime-validation.md)) |
| `react` + `react-dom` | Frontend UI |
| `vite` | Frontend build + dev server |

**Why Elysia over raw Bun.serve** (see [ADR-005](docs/adr/005-elysia-ws-plugin-pattern.md)): This project's WebSocket protocol has 10+ message types. Elysia provides declarative routing and plugin architecture. WS handler is exported as an Elysia plugin from `ws.ts`, mounted via `.use()` in `index.ts` for testability and separation of concerns.

**No additional API keys or LLM services required.** The SDK wraps the locally installed `claude` CLI binary and uses the existing `ANTHROPIC_API_KEY`.

## WebSocket Protocol

All messages are Zod-validated (see [ADR-001](docs/adr/001-zod-runtime-validation.md)). Schemas defined in `server/protocol.ts`.

### Client → Server

```typescript
{ type: "terminal_create", claudeUuid: string, cwd: string, agentKind?: "claude" | "omp" }
{ type: "terminal_send", claudeUuid: string, content: string }
{ type: "terminal_teardown", claudeUuid: string }
{ type: "list_terminal_sessions" }
{ type: "permission", requestId: string, allow: boolean, answers?: Record<string, string> }
{ type: "interrupt", sessionId: string }
{ type: "stop_task", sessionId: string, taskId: string }
{ type: "get_server_config" }
{ type: "transcript_page_request", sessionId: string,
  before?: { epoch: string, seq: number, recordId: string } }
```

Refused by the Zod gate with `{code:"invalid_message"}`: `set_permission_mode`,
`set_model`, `set_effort` and `set_env_vars` — the agent-settings controls,
removed once it was settled that an agent's mode, model and effort are the
agent's own settings and not cc-mobile's to decide (ADR-003 superseded) — plus
`list_sessions`,
`resume_session` and `set_session_title` (removed in #26 with the whole
browse-past-conversations path), plus #25's `new_session`, `send`, `command`,
`pty_send`, `get_session_info` and the `tmux_*` names that `terminal_*`
replaced. There is no compatibility window — a cached PWA bundle recovers with
a page reload.

### Server → Client

```typescript
{ type: "stream_chunk", sessionId: string, chunk: Record<string, unknown> }
{ type: "stream_end", sessionId: string }
{ type: "permission_request", sessionId: string, requestId: string,
  tool: { name: string, parameters: Record<string, unknown> } }
{ type: "capabilities", sessionId: string, commands: string[], agents: string[], model: string }
{ type: "terminal_created", claudeUuid: string, terminalName: string, paneRef: string }
{ type: "terminal_teardown_result", claudeUuid: string, killed: boolean }
{ type: "terminal_sessions",
  sessions: { sessionId: string, agent?: string, agentSessionValue: string | null,
              cwd: string, origin: "self" | "foreign", drivable: boolean,
              readable: boolean, gated: boolean,
              state?: "idle" | "running" | "requires_action" }[],
  claudeUuids: string[],
  states?: Record<string, "idle" | "running" | "requires_action"> }
{ type: "session_state", sessionId: string, state: "idle" | "running" | "requires_action" }
{ type: "error", code: string, message: string, sessionId?: string } // agent_blocked_notice: fenced blocked-screen words; agent_attention_notice: claude trust dialog while herdr says idle — read-only, never sends a key
{ type: "server_config", config: { allowedRoots?: string[] | null, homeDirectory?: string,
                                  availableAgents?: ("claude"|"omp")[] } }
{ type: "transcript_page", sessionId: string, epoch: string,
  records: Record<string, unknown>[],
  nextBefore: { epoch: string, seq: number, recordId: string } | null }
```

`transcript_page_request` / `transcript_page` are the history pull: the phone
asks a live session for one page of its own backlog and gets it outside the live
stream. The reply goes out with a bare `ws.send`, so it is never wrapped in an
`event` envelope and never replayed on reconnect — it answers one connection's
question, not the session's.

There is no page size on the wire; the server owns that number (50 records).
The page unit is "records the mapper keeps", not "records the phone renders", so
a page of tool plumbing can legitimately produce no visible bubbles — deciding
what is visible stays the client's job (ADR-015 M1), and the bodies in `records`
come out of the same `transcriptRecordToChunk` the live path uses.

`before` is the cursor the server last handed back, and it is a receipt, not just
a position: it names the file (`epoch`) and the record it stops before (`seq` +
`recordId`). The server re-proves both against the file the path resolves to
*now*, because a terminal `/clear` rotates that file underneath the phone. A
cursor from a retired epoch, one whose byte offset now holds a different record,
or one past EOF is not an error — it degrades to the newest page of the current
file, and the reply's own `epoch` says so. `nextBefore: null` means the
conversation starts at this page.

`epoch` is never empty and never a placeholder: a session that is not listed, has
no transcript key, or runs a kind with no registered reader gets
`{code:"transcript_unavailable"}` instead of a page. Every `stream_chunk.chunk`
carries the same `epoch`, plus `recordId` and `seq`, so the phone can tell a live
chunk and a page entry apart from a *different* conversation.

`server_config` now carries only what the server knows and the client cannot:
which paths are allowed, where `$HOME` is, and which agents this machine can
launch. The `permissionMode` / `model` / `effort` fields went with the messages
that set them.

`availableAgents` (#31) names the kinds this machine can launch — a
`LAUNCHABLE_AGENT_KINDS` entry whose binary is on `PATH`. A kind missing from it
is missing from the phone's new-session choice, which is the whole point: naming
an unavailable kind would start a pane that dies immediately.

Note the asymmetry with `sessions[].agent`, which stays a free string: that one
is **inbound** — herdr's own label, whose vocabulary grows between versions, so
an unknown value must survive. `agentKind` is **outbound** into something herdr
execs, so it is a closed enum and an unlisted kind is refused with
`invalid_message` before any workspace is created.

`terminal_sessions` doubles as the status bootstrap: `states` carries what herdr
says each live session is doing, read from one `session.snapshot` call. It is
optional — a daemon hiccup degrades it to `{}` rather than failing the reply —
and a pane id absent from the map means "no claim", never "idle". `claudeUuids`
mirrors `sessions[].sessionId`; the name is outdated (they are pane ids of every
kind of agent since #30) and kept so a cached bundle keeps reconciling.
`unknownUuids` was removed in #29 with the startup remount scan that produced it.
`session_created`, `session_list` and `session_history` were removed in #26 and
are refused.

`sessions[]` lists **every** pane herdr's `agent.list` returns, whatever kind of
agent is running in it (#30). `agent` is the kind herdr detected, passed through
verbatim — no enum and no normalisation, because the daemon's label vocabulary is
its own and grows between versions, and a label this build has not heard of must
not fail the parse. **An absent `agent` means herdr has not detected a kind yet;
it must never be read as claude.** The value is snapshot-time: no message ever
pushes a kind on its own, so a detection that completes later reaches the client
only when it asks for the list again (i.e. on reconnect).

`readable:true` means the session has a transcript key, its kind has a
registered transcript reader (claude and omp since #32), **and** — when the key
is a path rather than an id — the file that path names exists. Like `gated` it is
disclosure only — nothing refuses to drive, read back or ask permission because
it is `false`, and `drivable` stays `true` for every kind.

That last check is the one flag here that legitimately changes for a pane that
did not change. herdr reports omp's transcript **path** (`agent_session.kind ===
"path"`, only `pi` and `omp` get one) the moment the agent launches, but omp
creates the file when the first turn starts — a fresh omp nobody has spoken to
has a key and no file for as long as it stays quiet (probe 2026-08-06: still
absent after 120s idle). So a new omp lists unreadable, and the same pane lists
readable once it has said something. claude's `id` key is not checked the same
way: answering it means `resolveTranscriptPath`'s directory scan, on every
listing for every pane, for an answer that is always yes by the time an id
exists.

The key kind is server-side only — `ws.ts` projects the wire fields by name, so
`agentSessionKind` never reaches the phone.

Note: `stream_chunk.chunk` contains raw claude message objects (e.g., `{ type: "assistant", message: { content: [...] } }`) plus the three keys the server stamps on: `recordId` (the record's own `uuid`/`id`, absent when it has neither), `seq` (its absolute byte offset in the transcript — the only total order the data supports, since timestamps tie and invert) and `epoch` (16 hex chars naming the file). The frontend's `extractTextFromChunk()` parses these into displayable text. omp's records are mapped into that same envelope by `server/transcript/records.ts` — one mapper reads both vocabularies, since they do not overlap (omp puts every conversational record under `type:"message"` with the role inside; claude uses the role as the type) and which file is read is already decided per kind by the reader registry.

## Project Structure

```
cc-mobile/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/adr/                    # Architecture Decision Records
├── server/
│   ├── index.ts                 # Elysia app entry, listens on 0.0.0.0:3001
│   ├── config.ts                # CLI flag + env var parsing
│   ├── ws.ts                    # WebSocket handler as Elysia plugin (ADR-005)
│   ├── session-manager.ts       # Session map + settings state (no turn driver)
│   ├── terminal-control.ts      # terminal_create / terminal_teardown handlers
│   ├── claude-settings.ts       # Builds the --settings file that injects hooks
│   ├── herdr/                   # herdr socket backend (ADR-015)
│   ├── pty-permission-relay.ts  # PreToolUse hook ↔ WebSocket, 90s deny (ADR-002/014)
│   ├── pty-response-relay.ts    # Stop hook ↔ WebSocket readback (ADR-011)
│   ├── session-listing.ts       # List resumable sessions per project
│   ├── session-history.ts       # Session message history
│   ├── protocol.ts              # Zod schemas for WS messages (ADR-001)
│   └── __tests__/               # Bun test files
├── client/
│   ├── index.html               # PWA shell
│   ├── tsconfig.json            # Frontend-specific TS config
│   ├── main.tsx                 # React entry
│   ├── App.tsx                  # Layout: status bar + chat + quick actions + input
│   ├── styles.css               # Mobile-first CSS with dark/light/Claude themes
│   ├── components/
│   │   ├── ChatView.tsx         # Message list, auto-scroll, typing indicator
│   │   ├── InputBar.tsx         # Text input + autocomplete for / and @
│   │   ├── QuickActions.tsx     # Pinned command/agent buttons
│   │   ├── PickerPanel.tsx      # Full command/agent search panel
│   │   ├── PermissionBar.tsx    # Approve/Deny sticky bar (48px+ targets)
│   │   ├── SessionTabs.tsx      # Multi-session tab switching
│   │   ├── SessionListModal.tsx # Resume previous sessions
│   │   ├── ActivityPanel.tsx    # Live tool/agent status display
│   │   ├── StatusBar.tsx        # Cost, tokens, turns display
│   │   └── Settings.tsx         # Settings modal
│   ├── stores/
│   │   ├── app-store.ts         # Zustand: sessions, messages, permissions
│   │   └── settings-store.ts    # Zustand: defaultCwd, theme
│   ├── services/
│   │   ├── ws-service.ts        # WebSocket singleton (ADR-008)
│   │   ├── settings.ts          # localStorage persistence
│   │   ├── projects.ts          # Saved projects persistence
│   │   ├── pins.ts              # Pin management
│   │   └── tool-events.ts       # Tool event processing
│   └── __tests__/               # Frontend unit tests
└── public/                      # (Future: PWA manifest, icons)
```

## Key Implementation Details

### 1. Session Manager — session map + settings state

The in-process `query()` turn driver was removed in #25 (ADR-015). Turns are
driven by the herdr backend; `SessionManager` now holds only the session map —
the settings state went with the messages that wrote it. That map has had no
writer since #26 deleted the resume handler, so every session-scoped message
(`append_user_message`) answers `session_not_found`, and `interrupt` is a silent
no-op.

```typescript
class SessionManager {
  async createSession(sessionId, cwd, sdkSessionId?): Promise<void>;
  destroySession(sessionId): void;  // drops the entry, cleans up uploads
}
```

Browsing past conversations is gone since #26. herdr's live sessions are the
only sessions there are: the Projects screen lists saved projects, its activity
dot reflects the state herdr reports, and a project with nothing live shows no
dot at all.

### 2. Plugin Loading ([ADR-006](docs/adr/006-plugin-loading-from-user-settings.md))

No longer done by this server. The `claude` process herdr starts reads
`~/.claude` itself, so `settings-loader.ts` was deleted in #25 along with the
`query()` call whose `plugins` option was its only consumer.

### 3. Permission Relay — Promise + Timeout ([ADR-002](docs/adr/002-permission-bridge-promise-pattern.md))

The PreToolUse hook inside the pane POSTs to `/api/pty-permission`; the server
holds that HTTP request open, asks the phone over the WebSocket, and answers
with the user's decision. Unanswered after 90s → deny (#24). The Promise +
timeout shape is ADR-002's; the entry point is HTTP rather than `canUseTool`.

### 4. Quick Actions

**Frozen since #25**: the slash-command and agent lists came from the SDK's
`system`/`init` message, so nothing writes the on-disk cache any more. A machine
with a pre-#25 cache shows a stale list; one without shows an empty picker.
Frontend features:
- **Pinnable commands** — user pins frequently used commands to a compact bar (persisted in localStorage)
- **Input autocomplete** — typing `/` or `@` in InputBar filters matching commands/agents

### 5. Frontend State — Zustand + WsService ([ADR-008](docs/adr/008-zustand-multi-session-state.md))

Zustand store with per-session state isolation. `WsService` singleton manages the WebSocket connection and message routing. Components use Zustand selectors for state and call `wsService` methods directly — no intermediate hook layer. `extractTextFromChunk()` in `ws-service.ts` parses SDK message objects into displayable text. (Supersedes ADR-004.)

### 6. Touch UX Design

```
┌─────────────────────────────────┐
│ [Session A] [Session B] [+]    │ ← swipeable tabs
├─────────────────────────────────┤
│                                 │
│  You: Review this PR            │
│                                 │
│  Claude: I'll review the PR...  │
│  ┌─ Tool: Read ───────────────┐ │
│  │ src/auth.ts                │ │ ← collapsible tool use cards
│  └────────────────────────────┘ │
│                                 │
│  ┌─ Permission Required ──────┐ │
│  │ Edit: src/auth.ts:42       │ │
│  │ [  Deny  ] [  Approve  ]  │ │ ← large touch targets (48px+)
│  └────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│ ⚡ /commit  /plan  /review-pr   │ ← horizontal scroll quick actions
│ 🤖 Explore  Review  Plan       │
├─────────────────────────────────┤
│ [ Type a message...     ] [➤]  │ ← input bar, always visible
└─────────────────────────────────┘
```

Design principles:
- **Bottom-anchored actions** — thumb-reachable on phones
- **48px+ touch targets** — meets Apple/Google accessibility guidelines
- **Collapsible tool cards** — show tool name by default, expand for details
- **Sticky permission bar** — appears above quick actions when pending, can't be scrolled away
- **Auto-scroll** — follows streaming output, stops if user scrolls up

### 7. PWA Configuration (Planned)

```json
// public/manifest.json
{
  "name": "CCMobile",
  "short_name": "Claude",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Add to home screen → launches as standalone app (no browser chrome).

### 8. Herdr Terminal Layer ([ADR-015](docs/adr/015-herdr-terminal-layer.md))

Mobile "new session" launches a real agent process inside a herdr workspace (`terminal_create`/`terminal_send`/`terminal_teardown` messages) — `claude` by default, or any kind in `availableAgents` since #31. The same live session can be joined from the desktop with `herdr agent attach ccm-<first-8-of-uuid>`.

Each kind brings its own argv (`server/herdr/registry.ts`'s `argvFor`): claude
keeps `--session-id` (transcript naming), omp gets nothing — that is claude's
own CLI flag and omp would die on it. **Neither kind gets a gating flag**:
cc-mobile does not decide an agent's permission posture, so each runs at its own
configured setting exactly as it would if you had started it yourself.

**Limitation — trusted directories only**: the herdr path currently only works for working directories already trusted in `~/.claude.json`. For an untrusted directory, `claude` shows its folder-trust dialog on startup; the first prompt is swallowed by that dialog, and the readiness gate cannot detect this state. Until this is handled, only create sessions in previously trusted directories. Tracked in #24.

## Implementation Phases

### Phase 1: Core Loop (MVP) ✅

**Goal**: Send a message → see streaming response → approve/deny tools.

**Done**: Full core loop working with V1 SDK, plugin loading, typing indicator, Tailscale access.

### Phase 2: Quick Actions ✅

**Goal**: Tap buttons to trigger commands and agents.

**Done**: Pinnable quick actions bar, input autocomplete for `/` and `@`, all plugin commands/agents visible. PickerPanel with full search and pin management.

### Phase 3: Multi-Session ✅

**Goal**: Multiple sessions in parallel, tab switching.

**Done**: Zustand store with per-session state (ADR-008), WsService singleton, SessionTabs component with cwd input, tab switching, close button.

### Phase 4: Polish ✅

**Done**:
- Token-level streaming with deduplication (incremental text display)
- Cost & usage status bar (tokens, cost, turns, duration) via claude result messages
- Session resume — list previous sessions via `listSessions()` API, one-tap resume (SessionListModal)
- Tool & agent execution status display (ActivityPanel — live progress, completion, nested tools)
- Hook status display
- Dark/light/Claude theme toggle
- Settings page (default CWD, theme, pin management, localStorage persistence)
- Server-side CLI flags: `--default-cwd`, `--port`, `--hostname`
- `CC_MOBILE_ALLOWED_ROOTS` env var for project path whitelist
- E2E test suite (Playwright with mock server) — removed in #25; the live herdr suites (`bun run test:herdr`) replaced it

### Phase 5: Future

- Haptic feedback on approve/deny (Vibration API)
- PWA manifest + service worker for offline shell
- Production build: Elysia serves `dist/client/` static files
- Startup script (`bun run start`) for one-command launch (server + built frontend)
- Notification on permission request when app is backgrounded (Notification API)

## Development Setup

```bash
bun install                # Install dependencies
bun run dev:server         # Elysia backend on 0.0.0.0:3001
bunx vite --host           # Vite frontend on :5173 (with Tailscale access)
bun test                   # Run all tests
```

Vite proxies `/ws` → `ws://localhost:3001` and `/api` → `http://localhost:3001`. Vite root is `client/`, build output goes to `dist/client/`.

## Network Access

### Tailscale (recommended)

Already installed on dev machine. Phone has Tailscale app.

```
Phone → Tailscale → dev-machine:3001
```

Tailscale network membership is the auth by default. `CC_MOBILE_TRUSTED_USER` narrows it to one
tailnet login: the root request gate compares it against the `Tailscale-User-Login` header
`tailscale serve` injects — on the WebSocket upgrade as well as on plain HTTP — and refuses
anything else with `403 forbidden: identity`. Unset, the check does not run, which is what keeps
the Vite dev proxy (no such header) working; only set it behind `tailscale serve`.

WebSocket upgrades are additionally origin-checked, always: `Origin` must match `Host` (absent
`Origin` allowed, literal `null` refused), overridable with `CC_MOBILE_ALLOWED_ORIGINS`. A
refusal is `403 forbidden: origin`.

### Cloudflare Tunnel (alternative)

```bash
cloudflared tunnel --url http://localhost:3001
```

**Warning**: This exposes the service to the internet. Add auth (Cloudflare Access or Elysia auth plugin) if using this method.

## Security Considerations

1. **No auth on Tailscale** — acceptable because Tailscale is a private mesh network. Only your devices can connect.
2. **cc-mobile sets no agent settings** — it passes no permission or approval flag when launching, so each agent gates exactly as its own configuration says. For claude with no flag that is still "ask on every tool use". ([ADR-003](docs/adr/003-permission-mode-default.md) superseded; ADR-015 §2026-08-06)
3. **The session list discloses an ungated pane** — a `no permission gate` badge means that agent's argv says it will not stop to ask. Reading that flag is not setting it, and the badge never blocks driving the pane (Decision H4).
4. **Session persistence** — SDK sessions are resumed via `resume: sessionId` option in each `query()` call.
5. **WebSocket reconnect** — client auto-reconnects with exponential backoff (1s → 30s max).
6. **Every write is recorded** — `~/.claude-mobile/audit/audit.jsonl`, one line per prompt send, permission answer, and key send, 0600 in a 0700 directory. It names the device and the outcome and never the text, so it is evidence of what was done rather than a copy of it. Full description in CLAUDE.md's **Write Audit** section.

## SDK API Quick Reference

### V1 `query()` — Primary (see [ADR-007](docs/adr/007-use-v1-query-api.md))

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: "Review this code",
  options: {
    model: "claude-sonnet-4-6",
    cwd: "/path/to/project",
    permissionMode: "default",
    canUseTool: async (toolName, input, opts) => { /* ... */ },
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,
    skills: "all",  // Enable every discovered skill (replaces allowedTools: ["Skill"])
    plugins: [{ type: "local", path: "/path/to/plugin" }],
    resume: "sdk-session-id",  // For multi-turn
  },
});

for await (const msg of q) { /* ... */ }
q.close();
```

### V2 `unstable_v2_createSession()` — Not Used

Cleaner `send()`/`stream()` API but does **not support `plugins` option**. Monitor for future feature parity.

### Key Message Types

| Type | When | Key Fields |
|------|------|------------|
| `system` (subtype: `init`) | Session start | `session_id`, `tools`, `slash_commands`, `model` |
| `assistant` | Claude responds | `message.content[]` (text blocks, tool_use blocks) |
| `stream_event` | Partial tokens | `event` (requires `includePartialMessages`) |
| `result` (subtype: `success`) | Turn complete | `result`, `total_cost_usd`, `num_turns` |
| `result` (subtype: `error_*`) | Turn failed | `errors[]` |

### CanUseTool Callback

```typescript
canUseTool: async (toolName, input, { signal, suggestions, toolUseID, agentID }) => {
  // Return:
  return { behavior: "allow", updatedInput: input, toolUseID };
  // or:
  return { behavior: "deny", message: "User denied", toolUseID };
}
```

## References

- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK V2 Preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Agent SDK Quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart)
- [Agent SDK Demos (GitHub)](https://github.com/anthropics/claude-agent-sdk-demos)
- [npm: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
