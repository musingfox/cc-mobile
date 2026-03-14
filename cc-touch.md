# Claude Touch — Plan Document

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

### Why V2 SDK API

The SDK offers two interfaces. V2 (`unstable_v2_createSession`) is preferred for this project:

| | V1 `query()` | V2 `createSession()` |
|---|---|---|
| Multi-turn | Manage async generator state | `send()` + `stream()` per turn |
| WebSocket mapping | Complex — generator must stay alive | Clean — each turn is request/response |
| Session lifecycle | Implicit in generator | Explicit create/resume/close |

V2's `send()` / `stream()` pattern maps directly to WebSocket message exchange.

**Fallback**: V2 is still `unstable_`. If breaking changes occur, fallback to V1 `query()` with `streamInput()`.

## Dependencies

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | Core — programmatic Claude Code access |
| `elysia` | Bun-native server — routing, WebSocket (native), schema validation |
| `react` + `react-dom` | Frontend UI |
| `vite` | Frontend build + dev server |

**Why Elysia over raw Bun.serve**: This project's WebSocket protocol has 10+ message types. Elysia provides schema validation on WS messages, type-safe `ws.data` context, and declarative routing — avoiding manual `if/else` dispatch and `JSON.parse` boilerplate. Elysia's WebSocket runs on Bun's native implementation with zero overhead.

**No additional API keys or LLM services required.** The SDK wraps the locally installed `claude` CLI binary and uses the existing `ANTHROPIC_API_KEY`.

## WebSocket Protocol

### Client → Server

```typescript
// Send a chat message (creates session if needed)
{ type: "message", text: string, sessionId?: string }

// Trigger a slash command
{ type: "command", command: string, sessionId: string }
// e.g. { type: "command", command: "/commit", sessionId: "abc" }

// Respond to a permission prompt
{ type: "permission", toolUseId: string, allow: boolean, message?: string }

// Session lifecycle
{ type: "session.create", cwd: string }
{ type: "session.list" }
{ type: "session.close", sessionId: string }

// Query available commands and agents (called on connect)
{ type: "capabilities" }

// Interrupt current operation
{ type: "interrupt", sessionId: string }
```

### Server → Client

```typescript
// Streaming assistant text (token by token when partial messages enabled)
{ type: "assistant", sessionId: string, text: string, uuid: string }

// Partial streaming token
{ type: "stream", sessionId: string, event: BetaRawMessageStreamEvent }

// Tool execution notification
{ type: "tool_use", sessionId: string, tool: string, input: Record<string, unknown> }

// Tool execution summary (after tool completes)
{ type: "tool_summary", sessionId: string, toolName: string, summary: string }

// Permission prompt — client must respond
{ type: "permission_request", sessionId: string, toolUseId: string, toolName: string,
  input: Record<string, unknown>, suggestions?: PermissionUpdate[],
  decisionReason?: string }

// Session completed one turn
{ type: "result", sessionId: string, success: boolean, text: string,
  cost: number, turns: number }

// Error
{ type: "error", sessionId: string?, message: string, code?: string }

// Session info
{ type: "session", sessionId: string, cwd: string, status: "active" | "idle" | "closed" }

// Available capabilities (response to "capabilities" request)
{ type: "capabilities", commands: SlashCommand[], agents: AgentInfo[],
  models: ModelInfo[], outputStyles: string[] }
```

## Project Structure

```
cc-touch/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── server/
│   ├── index.ts                 # Elysia app entry, serves API + WS + static
│   ├── ws.ts                    # WebSocket handler with schema validation
│   ├── session-manager.ts       # Multi-session lifecycle (V2 SDK)
│   ├── permission-bridge.ts     # canUseTool ↔ WebSocket relay
│   └── protocol.ts              # Shared types (client ↔ server)
├── client/
│   ├── index.html               # PWA shell
│   ├── main.tsx                 # React entry
│   ├── App.tsx                  # Layout + routing
│   ├── components/
│   │   ├── ChatView.tsx         # Message list, auto-scroll
│   │   ├── MessageBubble.tsx    # Single message (text, tool use, etc.)
│   │   ├── QuickActions.tsx     # Command & agent shortcut bar
│   │   ├── PermissionBar.tsx    # Approve/Deny sticky bar
│   │   ├── SessionTabs.tsx      # Horizontal swipeable tabs
│   │   └── InputBar.tsx         # Text input + send button
│   ├── hooks/
│   │   ├── useSocket.ts         # WebSocket connection + reconnect
│   │   └── useSession.ts        # Session state management
│   ├── stores/
│   │   └── app-store.ts         # Global state (sessions, messages, capabilities)
│   └── styles.css               # Mobile-first CSS
└── public/
    ├── manifest.json            # PWA manifest
    └── icon-192.png             # App icon
```

## Key Implementation Details

### 1. Session Manager (`session-manager.ts`)

Wraps the V2 SDK API. Each session maps to a `cwd` (project directory).

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  listSessions,
  type SDKMessage,
  type SDKSession,
} from "@anthropic-ai/claude-agent-sdk";

class SessionManager {
  private sessions: Map<string, ManagedSession>;

  async create(cwd: string): Promise<string>;
  async send(sessionId: string, text: string): Promise<AsyncGenerator<SDKMessage>>;
  async close(sessionId: string): Promise<void>;
  async list(): Promise<SessionInfo[]>;
}

interface ManagedSession {
  sdk: SDKSession;
  cwd: string;
  status: "active" | "idle" | "closed";
  pendingPermissions: Map<string, PermissionResolver>;
}
```

Key behaviors:
- Creates sessions with `settingSources: ["user", "project", "local"]` to load CLAUDE.md
- Uses `systemPrompt: { type: "preset", preset: "claude_code" }` for full Claude Code behavior
- Sets `includePartialMessages: true` for token-level streaming
- Permission mode starts as `"default"` — all tool approvals relay through WebSocket

### 2. Permission Bridge (`permission-bridge.ts`)

The critical piece: connects SDK's `canUseTool` callback to the WebSocket client.

```typescript
// When SDK needs permission:
canUseTool: async (toolName, input, options) => {
  // 1. Send permission_request to client via WebSocket
  ws.send({ type: "permission_request", toolUseId: options.toolUseID, toolName, input });

  // 2. Wait for client response (Promise that resolves when client responds)
  const response = await waitForPermissionResponse(options.toolUseID, options.signal);

  // 3. Return SDK-compatible result
  return response.allow
    ? { behavior: "allow", updatedInput: input, toolUseID: options.toolUseID }
    : { behavior: "deny", message: response.message ?? "Denied by user", toolUseID: options.toolUseID };
}
```

**Note on V2 and canUseTool**: V2's `createSession` accepts options similar to V1's `query()`. The `canUseTool` callback works the same way — it's called whenever a tool use isn't pre-approved. The V2 session keeps the callback alive across multiple `send()`/`stream()` turns.

### 3. Quick Actions (`QuickActions.tsx`)

Dynamically populated from the SDK's `supportedCommands()` and `supportedAgents()`.

```typescript
// On initial connection, server queries SDK:
const initResult = await session.sdk.initializationResult?.();
// Or for V1: await queryObj.supportedCommands() / supportedAgents()

// Returns:
// commands: [{ name: "/commit", description: "..." }, ...]
// agents:   [{ name: "Explore", description: "..." }, ...]
```

Frontend renders these as tappable buttons. Tapping a command sends:
```typescript
ws.send({ type: "command", command: "/commit", sessionId: currentSession })
```

The server translates this to a `session.send("/commit")` call.

### 4. Frontend State (`app-store.ts`)

Minimal global state using React `useReducer` or Zustand:

```typescript
interface AppState {
  // Connection
  connected: boolean;

  // Sessions
  sessions: Map<string, SessionState>;
  activeSessionId: string | null;

  // Capabilities (loaded once on connect)
  commands: SlashCommand[];
  agents: AgentInfo[];

  // Pending permission (at most one at a time per session)
  pendingPermission: PermissionRequest | null;
}

interface SessionState {
  id: string;
  cwd: string;
  status: "active" | "idle" | "closed";
  messages: UIMessage[];
  isStreaming: boolean;
}
```

### 5. Touch UX Design

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

### 6. PWA Configuration

```json
// public/manifest.json
{
  "name": "Claude Touch",
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

### Phase 1: Core Loop (MVP)

**Goal**: Send a message → see streaming response → approve/deny tools.

Files:
1. `server/protocol.ts` — shared message types
2. `server/session-manager.ts` — single session, V2 SDK
3. `server/permission-bridge.ts` — canUseTool ↔ WebSocket
4. `server/ws.ts` — WebSocket handler with Elysia schema validation
5. `server/index.ts` — Elysia app entry
6. `client/hooks/useSocket.ts` — WebSocket hook
7. `client/components/ChatView.tsx` — message rendering
8. `client/components/PermissionBar.tsx` — approve/deny
9. `client/components/InputBar.tsx` — text input
10. `client/App.tsx` + `client/main.tsx` — app shell

**Definition of done**: Can open browser on phone, send "hello", see streaming response, approve a tool use.

### Phase 2: Quick Actions

**Goal**: Tap buttons to trigger commands and agents.

Files:
1. `client/components/QuickActions.tsx`
2. Server-side: query `supportedCommands()` / `supportedAgents()` on session init
3. `server/ws.ts` — handle `command` message type

**Definition of done**: Quick action bar shows available commands/agents, tapping one sends it.

### Phase 3: Multi-Session

**Goal**: Multiple sessions in parallel, tab switching.

Files:
1. `server/session-manager.ts` — extend to multi-session Map
2. `client/components/SessionTabs.tsx`
3. `client/stores/app-store.ts` — session state management
4. `client/hooks/useSession.ts`

**Definition of done**: Can create multiple sessions with different cwds, switch between them.

### Phase 4: Polish

- PWA manifest + service worker for offline shell
- Reconnect logic (WebSocket drop handling)
- Dark/light theme toggle
- Settings page (default cwd, permission mode preferences)
- Haptic feedback on approve/deny (via Vibration API)

## Development Setup

```bash
# Init project
mkdir cc-touch && cd cc-touch
bun init

# Install dependencies
bun add @anthropic-ai/claude-agent-sdk elysia
bun add react react-dom
bun add -d @types/react @types/react-dom vite @vitejs/plugin-react typescript

# Dev server (serves both API and frontend)
bun run dev
```

### Vite Config

Vite dev server proxies `/ws` and `/api` to the Elysia backend:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3001", ws: true },
      "/api": { target: "http://localhost:3001" },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
```

### Server Entry

```typescript
// server/index.ts
import { Elysia, t } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { SessionManager } from "./session-manager";

const sessionManager = new SessionManager();

const app = new Elysia()
  // REST endpoints
  .get("/api/sessions", () => sessionManager.list())
  .post("/api/sessions", ({ body }) => sessionManager.create(body.cwd), {
    body: t.Object({ cwd: t.String() }),
  })

  // WebSocket — schema-validated, type-safe ws.data
  .ws("/ws", {
    body: t.Object({
      type: t.String(),
      text: t.Optional(t.String()),
      sessionId: t.Optional(t.String()),
      command: t.Optional(t.String()),
      toolUseId: t.Optional(t.String()),
      allow: t.Optional(t.Boolean()),
      cwd: t.Optional(t.String()),
      message: t.Optional(t.String()),
    }),
    open(ws) {
      // Send capabilities on connect
    },
    message(ws, data) {
      // data is typed — no manual JSON.parse needed
      switch (data.type) {
        case "message": /* ... */ break;
        case "command": /* ... */ break;
        case "permission": /* ... */ break;
        case "session.create": /* ... */ break;
        case "interrupt": /* ... */ break;
      }
    },
    close(ws) {
      // Cleanup
    },
  })

  // Static files (production)
  .use(staticPlugin({ assets: "dist/client", prefix: "/" }))

  .listen(3001);

console.log(`Claude Touch running at http://localhost:${app.server!.port}`);
```

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
2. **Permission mode defaults to `"default"`** — every tool use requires explicit approval on the phone. This is intentional for remote usage.
3. **No `bypassPermissions`** — never auto-approve from a remote device. The whole point is interactive control.
4. **Session persistence** — sessions are persisted by default (`persistSession: true`), allowing resume after disconnects.
5. **WebSocket reconnect** — client auto-reconnects with exponential backoff. Pending permission prompts are re-sent on reconnect.

## SDK API Quick Reference

### V2 (Primary)

```typescript
import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt,
  listSessions,
  getSessionMessages,
} from "@anthropic-ai/claude-agent-sdk";

// Create session
const session = unstable_v2_createSession({
  model: "claude-sonnet-4-6",
  // ... options same as V1
});

// Send + stream
await session.send("Review this code");
for await (const msg of session.stream()) { /* ... */ }

// Resume
const resumed = unstable_v2_resumeSession(sessionId, { model: "claude-sonnet-4-6" });
```

### V1 (Fallback)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: "Review this code",
  options: {
    cwd: "/path/to/project",
    permissionMode: "default",
    canUseTool: async (toolName, input, opts) => { /* ... */ },
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,
  },
});

// Useful Query methods:
await q.supportedCommands();  // → SlashCommand[]
await q.supportedAgents();    // → AgentInfo[]
await q.initializationResult(); // → commands, agents, models, account, output_style
await q.interrupt();
q.close();
```

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
