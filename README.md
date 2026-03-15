# Claude Code Mobile

Touch-optimized web UI for [Claude Code](https://claude.ai/code), designed for phones and tablets.

Not a terminal replacement — a touch translation of terminal interactions. Run it on your dev machine, access it from your phone via Tailscale or local network.

```
┌─────────────────────────────────┐
│ [Session A] [Session B] [+]    │  swipeable tabs
├─────────────────────────────────┤
│                                 │
│  You: Review this PR            │
│                                 │
│  Claude: I'll review the PR...  │
│  ┌─ Tool: Read ───────────────┐ │
│  │ src/auth.ts                │ │  collapsible tool cards
│  └────────────────────────────┘ │
│                                 │
│  ┌─ Permission Required ──────┐ │
│  │ Edit: src/auth.ts:42       │ │
│  │ [  Deny  ] [  Approve  ]  │ │  48px+ touch targets
│  └────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│ /commit  /plan  /review-pr      │  pinnable quick actions
├─────────────────────────────────┤
│ [ Type a message...     ] [>]  │  input bar
└─────────────────────────────────┘
```

## Features

- **Permission prompts** — tap Approve/Deny instead of typing y/n
- **Quick actions** — pinnable slash commands and agent buttons
- **Multi-session** — run multiple Claude Code sessions in parallel with tab switching
- **Input autocomplete** — type `/` or `@` to filter commands and agents
- **Plugin support** — loads all installed Claude Code plugins and skills
- **Theme** — dark, light, and Claude brand themes
- **Settings** — configurable default working directory, theme, pin management
- **Saved projects** — recent working directories saved for one-tap access

## Requirements

- [Bun](https://bun.sh) runtime
- [Claude Code CLI](https://claude.ai/code) installed locally (the `claude` binary)
- An active `ANTHROPIC_API_KEY` (used by the SDK through the CLI)

## Quick Start

```bash
git clone <repo-url> && cd claude-code-mobile
bun install
bun run dev:server    # Backend on 0.0.0.0:3001
bunx vite --host      # Frontend on :5173 (in another terminal)
```

Open `http://localhost:5173` on your browser, or use your Tailscale IP to access from your phone.

## Server CLI Flags

```bash
bun run dev:server -- --port 4000 --default-cwd ~/workspace --permission-mode acceptEdits
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `3001` | Server port |
| `--default-cwd` | none | Default working directory for new sessions |
| `--permission-mode` | `default` | SDK permission mode: `default`, `acceptEdits`, `bypassPermissions` |
| `--hostname` | `0.0.0.0` | Server bind address |

**Security note**: `--permission-mode` can only be set via CLI flag (server-side opt-in). The client UI can query the current mode but cannot change it.

## Network Access

### Tailscale (recommended)

Already have Tailscale on your dev machine and phone? Just access it:

```
Phone -> Tailscale -> dev-machine:5173
```

No auth layer needed — Tailscale network membership is the auth.

### Cloudflare Tunnel (alternative)

```bash
cloudflared tunnel --url http://localhost:3001
```

**Warning**: This exposes the service to the internet. Add auth (Cloudflare Access or similar) if using this method.

## Architecture

```
Mobile Browser (PWA)  <--WebSocket-->  Elysia Server (0.0.0.0:3001)
                                         ├─ WS Plugin (ws.ts)
                                         ├─ Session Manager (V1 query + resume)
                                         ├─ Permission Bridge (canUseTool relay)
                                         ├─ Settings Loader (plugin discovery)
                                         └─ Config (CLI flags)
                                                ↓
                                       Claude Code CLI (local)
```

- **SDK**: Uses V1 `query()` API with resume pattern for multi-turn ([ADR-007](docs/adr/007-use-v1-query-api.md))
- **Plugins**: Reads `~/.claude/settings.json` + `~/.claude/plugins/installed_plugins.json` ([ADR-006](docs/adr/006-plugin-loading-from-user-settings.md))
- **Permissions**: Promise-based relay with 60s timeout ([ADR-002](docs/adr/002-permission-bridge-promise-pattern.md))
- **State**: Zustand store with per-session isolation ([ADR-008](docs/adr/008-zustand-multi-session-state.md))
- **Validation**: Zod schemas for all WebSocket messages ([ADR-001](docs/adr/001-zod-runtime-validation.md))

## Development

```bash
bun install              # Install dependencies
bun run dev:server       # Elysia backend on 0.0.0.0:3001
bunx vite --host         # Vite frontend on :5173
bun test                 # Run all tests (bun:test)
bun run build            # Production build (dist/client/)
```

Vite dev server proxies `/ws` and `/api` to Elysia backend on port 3001.

### Project Structure

```
claude-code-mobile/
├── server/
│   ├── index.ts                # Elysia app entry
│   ├── config.ts               # CLI flag parsing
│   ├── ws.ts                   # WebSocket handler (Elysia plugin)
│   ├── session-manager.ts      # V1 query() with resume pattern
│   ├── permission-bridge.ts    # canUseTool <-> WebSocket relay
│   ├── settings-loader.ts      # Plugin discovery from ~/.claude/
│   ├── protocol.ts             # Zod schemas for WS messages
│   └── __tests__/
├── client/
│   ├── App.tsx                 # Layout + theme application
│   ├── main.tsx                # React entry
│   ├── styles.css              # CSS variables, 3 themes
│   ├── components/
│   │   ├── ChatView.tsx        # Message list + typing indicator
│   │   ├── QuickActions.tsx    # Pinned command/agent buttons
│   │   ├── PermissionBar.tsx   # Approve/Deny bar
│   │   ├── InputBar.tsx        # Text input + autocomplete
│   │   ├── SessionTabs.tsx     # Multi-session tabs
│   │   └── Settings.tsx        # Settings modal
│   ├── stores/
│   │   ├── app-store.ts        # Zustand: sessions, messages, permissions
│   │   └── settings-store.ts   # Zustand: defaultCwd, theme
│   ├── services/
│   │   ├── ws-service.ts       # WebSocket singleton
│   │   ├── settings.ts         # localStorage persistence
│   │   └── projects.ts         # Saved projects persistence
│   └── __tests__/
├── docs/adr/                   # Architecture Decision Records
├── vite.config.ts
└── package.json
```

## Roadmap

### Completed

- **Phase 1**: Core loop — send messages, streaming response, approve/deny tools
- **Phase 2**: Quick actions — pinnable commands/agents, input autocomplete
- **Phase 3**: Multi-session — parallel sessions, tab switching, saved projects
- **Phase 4 (partial)**: Settings — CLI flags, default CWD, theme system, pin management

### Planned

**UX**
- Token-level streaming (incremental text display)
- Status line (model, token usage, cost, session duration)
- Haptic feedback on approve/deny (Vibration API)

**Infrastructure**
- PWA manifest + service worker for offline shell
- Production build: Elysia serves static files
- One-command startup script

**Integration**
- Session resume via `listSessions()` API
- Voice input (Web Speech API)
- Background notifications for permission requests (Notification API)

## Architecture Decision Records

| ADR | Decision |
|-----|----------|
| [001](docs/adr/001-zod-runtime-validation.md) | Zod for runtime WebSocket message validation |
| [002](docs/adr/002-permission-bridge-promise-pattern.md) | Promise + timeout pattern for permission relay |
| [003](docs/adr/003-permission-mode-default.md) | Default to `"default"` permission mode, server-side opt-in |
| [004](docs/adr/004-centralized-socket-hook.md) | Centralized socket hook (superseded by ADR-008) |
| [005](docs/adr/005-elysia-ws-plugin-pattern.md) | Elysia WS plugin pattern for testability |
| [006](docs/adr/006-plugin-loading-from-user-settings.md) | Plugin loading from ~/.claude/ settings |
| [007](docs/adr/007-use-v1-query-api.md) | V1 query() API over V2 (plugin support) |
| [008](docs/adr/008-zustand-multi-session-state.md) | Zustand store for multi-session state |

## License

MIT
