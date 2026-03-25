# CCMobile

Touch-optimized web UI for [Claude Code](https://claude.ai/code), designed for phones and tablets.

> *This project is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.*

Not a terminal replacement — a touch translation of terminal interactions. Run it on your dev machine, access it from your phone via Tailscale or local network.

```
┌─────────────────────────────────┐
│ [Session A] [Session B] [+]     │  swipeable tabs
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
│  │ [  Deny  ] [  Approve  ]  │  │  48px+ touch targets
│  └────────────────────────────┘ │
│                                 │
│  ── Read (0.3s) ✓  Grep (1.2s)  │  live tool/agent status
├─────────────────────────────────┤
│ /commit  /plan  /review-pr      │  pinnable quick actions
├─────────────────────────────────┤
│  $0.03 · 15.7k tokens · 2 turns │  cost & usage status bar
├─────────────────────────────────┤
│ [ Type a message...     ] [>]   │  input bar
└─────────────────────────────────┘
```

## Features

- **Token-level streaming** — incremental text display as Claude responds
- **Permission prompts** — tap Approve/Deny instead of typing y/n
- **Quick actions** — pinnable slash commands and agent buttons with search panel
- **Multi-session** — run multiple Claude Code sessions in parallel with tab switching
- **Session resume** — list and resume previous sessions from any project
- **Input autocomplete** — type `/` or `@` to filter commands and agents
- **Tool & agent status** — live display of running tools, agent progress, and completion
- **Cost & usage bar** — token count, cost, turns, and duration per session
- **Plugin support** — loads all installed Claude Code plugins and skills
- **Theme** — dark, light, and Claude brand themes
- **Settings** — configurable default working directory, theme, pin management
- **Saved projects** — recent working directories saved for one-tap access
- **Path whitelist** — restrict allowed working directories via environment variable

## Requirements

- [Bun](https://bun.sh) runtime (v1.0+)
- [Claude Code CLI](https://claude.ai/code) installed locally (the `claude` binary)
- An active `ANTHROPIC_API_KEY` (used by the SDK through the CLI)

## Quick Start

```bash
# Clone the repo and install
cd cc-mobile
bun install

# Start backend (terminal 1)
bun run dev:server

# Start frontend (terminal 2)
bunx vite --host
```

Open `http://localhost:5173` on your browser, or use your machine's IP / Tailscale address to access from your phone.

## Configuration

### Server CLI Flags

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

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CC_MOBILE_ALLOWED_ROOTS` | none | Comma-separated list of allowed working directory roots. When set, sessions can only be created under these paths. Example: `CC_MOBILE_ALLOWED_ROOTS=~/workspace,~/projects` |

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
                                         ├─ Session Listing (list/resume sessions)
                                         ├─ Settings Loader (plugin discovery)
                                         └─ Config (CLI flags + env vars)
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
bun test                 # Run unit tests (bun:test)
bun run test:e2e         # Run e2e tests (Playwright)
bun run build            # Production build (dist/client/)
```

Vite dev server proxies `/ws` and `/api` to Elysia backend on port 3001.

### Project Structure

```
cc-mobile/
├── server/
│   ├── index.ts                # Elysia app entry
│   ├── config.ts               # CLI flag + env var parsing
│   ├── ws.ts                   # WebSocket handler (Elysia plugin)
│   ├── session-manager.ts      # V1 query() with resume pattern
│   ├── permission-bridge.ts    # canUseTool <-> WebSocket relay
│   ├── session-listing.ts      # List resumable sessions per project
│   ├── session-history.ts      # Session message history
│   ├── settings-loader.ts      # Plugin discovery from ~/.claude/
│   ├── protocol.ts             # Zod schemas for WS messages
│   └── __tests__/
├── client/
│   ├── App.tsx                 # Layout + theme application
│   ├── main.tsx                # React entry
│   ├── styles.css              # CSS variables, 3 themes
│   ├── components/
│   │   ├── ChatView.tsx        # Message list + typing indicator
│   │   ├── InputBar.tsx        # Text input + autocomplete
│   │   ├── QuickActions.tsx    # Pinned command/agent buttons
│   │   ├── PickerPanel.tsx     # Full command/agent search panel
│   │   ├── PermissionBar.tsx   # Approve/Deny bar
│   │   ├── SessionTabs.tsx     # Multi-session tabs
│   │   ├── SessionListModal.tsx # Resume previous sessions
│   │   ├── ActivityPanel.tsx   # Live tool/agent status display
│   │   ├── StatusBar.tsx       # Cost, tokens, turns display
│   │   └── Settings.tsx        # Settings modal
│   ├── stores/
│   │   ├── app-store.ts        # Zustand: sessions, messages, permissions
│   │   └── settings-store.ts   # Zustand: defaultCwd, theme
│   ├── services/
│   │   ├── ws-service.ts       # WebSocket singleton
│   │   ├── settings.ts         # localStorage persistence
│   │   ├── projects.ts         # Saved projects persistence
│   │   ├── pins.ts             # Pin management
│   │   └── tool-events.ts      # Tool event processing
│   ├── utils/
│   │   └── command-filter.ts   # Command/agent search filtering
│   └── __tests__/
├── e2e/                        # Playwright e2e tests
├── docs/adr/                   # Architecture Decision Records
├── vite.config.ts
├── playwright.config.ts
└── package.json
```

## Roadmap

### Completed

- **Phase 1**: Core loop — send messages, streaming response, approve/deny tools
- **Phase 2**: Quick actions — pinnable commands/agents, input autocomplete
- **Phase 3**: Multi-session — parallel sessions, tab switching, saved projects
- **Phase 4**: Polish — settings (CLI flags, default CWD, theme, pins), token-level streaming, cost/usage status bar, session resume, tool/agent activity display, path whitelist, e2e tests

### Planned

- Haptic feedback on approve/deny (Vibration API)
- PWA manifest + service worker for offline shell
- Production build: Elysia serves static files + one-command startup
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

## Contributing

Feedback and contributions welcome! This project is in active development.

### Reporting Issues

Open an issue describing:
- What you expected vs what happened
- Steps to reproduce
- Your environment (OS, Bun version, Claude Code CLI version)

### Development Workflow

1. Fork and clone the repo
2. `bun install`
3. Run `bun test` to verify the test suite passes
4. Make your changes on a feature branch
5. Run `bun test` and `bun run test:e2e` before submitting
6. Open a PR with a clear description of the change

### Code Conventions

- TypeScript throughout (server + client)
- Zod schemas for all WebSocket message types
- Bun test for unit tests, Playwright for e2e
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`)

## License

[MIT](LICENSE)
