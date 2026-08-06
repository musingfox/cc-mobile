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
```

Refused by the Zod gate with `{code:"invalid_message"}`: `list_sessions`,
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
{ type: "error", code: string, message: string, sessionId?: string }
{ type: "server_config", config: { permissionMode: string, availableAgents?: ("claude"|"omp")[] } }
```

`availableAgents` (#31) names the kinds this machine can launch — a
`LAUNCHABLE_AGENT_KINDS` entry whose binary is on `PATH`. It rides only on the
reply to `get_server_config`; the `set_model` / `set_effort` /
`set_permission_mode` echoes carry a partial config and the client merges field
by field, so an absent list means "unchanged", never "none". A kind missing from
it is missing from the phone's new-session choice, which is the whole point:
naming an unavailable kind would start a pane that dies immediately.

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

Note: `stream_chunk.chunk` contains raw claude message objects (e.g., `{ type: "assistant", message: { content: [...] } }`). The frontend's `extractTextFromChunk()` parses these into displayable text. omp's records are mapped into that same envelope by `server/transcript/records.ts` — one mapper reads both vocabularies, since they do not overlap (omp puts every conversational record under `type:"message"` with the role inside; claude uses the role as the type) and which file is read is already decided per kind by the reader registry.

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
driven by the herdr backend; `SessionManager` now only holds the settings the
settings screen reads back through `get_server_config`. Its session map has had
no writer since #26 deleted the resume handler, so every session-scoped message
(`set_permission_mode` with a `sessionId`, `append_user_message`) answers
`session_not_found`, and `interrupt` is a silent no-op.

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
gets `--permission-mode` and `--session-id`, omp gets none — those are claude's
own CLI flags and omp would die on them. omp's permission handling is #33.

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
- Server-side CLI flags: `--default-cwd`, `--permission-mode`, `--port`, `--hostname`
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

No auth layer needed — Tailscale network membership is the auth.

### Cloudflare Tunnel (alternative)

```bash
cloudflared tunnel --url http://localhost:3001
```

**Warning**: This exposes the service to the internet. Add auth (Cloudflare Access or Elysia auth plugin) if using this method.

## Security Considerations

1. **No auth on Tailscale** — acceptable because Tailscale is a private mesh network. Only your devices can connect.
2. **Permission mode defaults to `"default"`** — every tool use requires explicit approval on the phone. This is intentional for remote usage. (see [ADR-003](docs/adr/003-permission-mode-default.md))
3. **Configurable permissionMode** — planned for Phase 4 via UI toggle or CLI flag. Must require server-side opt-in, never allow setting from WebSocket client alone.
4. **Session persistence** — SDK sessions are resumed via `resume: sessionId` option in each `query()` call.
5. **WebSocket reconnect** — client auto-reconnects with exponential backoff (1s → 30s max).

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
