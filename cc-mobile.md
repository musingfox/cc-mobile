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
| `@anthropic-ai/claude-agent-sdk` | Core — programmatic Claude Code access |
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
{ type: "new_session", cwd: string }
{ type: "send", sessionId: string, content: string }
{ type: "command", sessionId: string, command: string }
{ type: "permission", requestId: string, allow: boolean }
{ type: "interrupt", sessionId: string }
{ type: "get_server_config" }
{ type: "list_sessions", dir?: string, limit?: number, offset?: number }
{ type: "resume_session", sdkSessionId: string, cwd: string }
```

### Server → Client

```typescript
{ type: "session_created", sessionId: string, cwd: string }
{ type: "stream_chunk", sessionId: string, chunk: Record<string, unknown> }
{ type: "stream_end", sessionId: string }
{ type: "permission_request", sessionId: string, requestId: string,
  tool: { name: string, parameters: Record<string, unknown> } }
{ type: "capabilities", sessionId: string, commands: string[], agents: string[], model: string }
{ type: "result", sessionId: string, success: boolean, cost?: number }
{ type: "error", code: string, message: string, sessionId?: string }
{ type: "server_config", config: { permissionMode: string } }
```

Note: `stream_chunk.chunk` contains raw SDK message objects (e.g., `{ type: "assistant", message: { content: [...] } }`). The frontend's `extractTextFromChunk()` parses these into displayable text.

## Project Structure

```
cc-mobile/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── playwright.config.ts
├── docs/adr/                    # Architecture Decision Records
├── server/
│   ├── index.ts                 # Elysia app entry, listens on 0.0.0.0:3001
│   ├── config.ts                # CLI flag + env var parsing
│   ├── ws.ts                    # WebSocket handler as Elysia plugin (ADR-005)
│   ├── session-manager.ts       # V1 query() with resume pattern (ADR-007)
│   ├── permission-bridge.ts     # canUseTool ↔ WebSocket relay (ADR-002)
│   ├── session-listing.ts       # List resumable sessions per project
│   ├── session-history.ts       # Session message history
│   ├── settings-loader.ts       # Loads user plugins from ~/.claude/ (ADR-006)
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
│   │   ├── ws-service.ts        # WebSocket singleton
│   │   ├── settings.ts          # localStorage persistence
│   │   ├── projects.ts          # Saved projects persistence
│   │   ├── pins.ts              # Pin management
│   │   └── tool-events.ts       # Tool event processing
│   ├── hooks/
│   │   └── useSocket.ts         # WebSocket state + extractTextFromChunk
│   └── __tests__/               # Frontend unit tests
├── e2e/                         # Playwright e2e tests
└── public/                      # (Future: PWA manifest, icons)
```

## Key Implementation Details

### 1. Session Manager — V1 Resume Pattern ([ADR-007](docs/adr/007-use-v1-query-api.md))

Uses V1 `query()` API. `createSession()` is lightweight (stores config only). Each `sendMessage()` creates a fresh `query()` with `resume: sdkSessionId` for multi-turn continuity.

```typescript
class SessionManager {
  async createSession(sessionId, cwd, canUseTool): Promise<void>;  // stores config
  async *sendMessage(sessionId, content): AsyncGenerator<SDKMessage>;  // query() + resume
  destroySession(sessionId): void;  // closes active query
}
```

SDK options: `settingSources: ["user", "project", "local"]`, `systemPrompt: { type: "preset", preset: "claude_code" }`, `includePartialMessages: true`, `permissionMode: "default"`, `allowedTools: ["Skill"]`, `plugins` loaded from user settings.

### 2. Plugin Loading ([ADR-006](docs/adr/006-plugin-loading-from-user-settings.md))

`settings-loader.ts` reads `~/.claude/settings.json` (`enabledPlugins`) and `~/.claude/plugins/installed_plugins.json` (`installPath`), cross-references to produce `SdkPluginConfig[]` passed to each `query()` call. `allowedTools: ["Skill"]` is required for skills to activate.

### 3. Permission Bridge — Promise + Timeout ([ADR-002](docs/adr/002-permission-bridge-promise-pattern.md))

Bridges SDK's `canUseTool` callback to WebSocket client via Promise relay. Each tool use creates a pending Promise; client's approve/deny response resolves it. 60s timeout defaults to interrupt (deny + pause conversation).

### 4. Quick Actions

Capabilities extracted from SDK system init message (`slash_commands`, `agents` fields) during the first `sendMessage()` turn. Frontend features:
- **Pinnable commands** — user pins frequently used commands to a compact bar (persisted in localStorage)
- **Input autocomplete** — typing `/` or `@` in InputBar filters matching commands/agents

### 5. Frontend State — Zustand + WsService ([ADR-008](docs/adr/008-zustand-multi-session-state.md))

Zustand store with per-session state isolation. `WsService` singleton manages the WebSocket connection. `extractTextFromChunk()` parses SDK message objects into displayable text. (Supersedes ADR-004 centralized useSocket hook from Phase 1.)

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
- Cost & usage status bar (tokens, cost, turns, duration) via SDK result messages
- Session resume — list previous sessions via `listSessions()` API, one-tap resume (SessionListModal)
- Tool & agent execution status display (ActivityPanel — live progress, completion, nested tools)
- Hook status display
- Dark/light/Claude theme toggle
- Settings page (default CWD, theme, pin management, localStorage persistence)
- Server-side CLI flags: `--default-cwd`, `--permission-mode`, `--port`, `--hostname`
- `CC_MOBILE_ALLOWED_ROOTS` env var for project path whitelist
- E2E test suite (Playwright with mock server)

### Phase 5: Future

- Haptic feedback on approve/deny (Vibration API)
- PWA manifest + service worker for offline shell
- Production build: Elysia serves `dist/client/` static files
- Startup script (`bun run start`) for one-command launch (server + built frontend)
- Voice input support (Web Speech API)
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
    allowedTools: ["Skill"],  // Required for plugin skills
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
