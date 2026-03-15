# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Mobile — a touch-optimized PWA for interacting with Claude Code from phones/tablets. Runs on the dev machine, accessed via Tailscale or local network. Translates terminal interactions (permission prompts, slash commands, agent invocations) into tap-friendly UI elements.

## Tech Stack

- **Runtime**: Bun
- **Backend**: Elysia (Bun-native server with native WebSocket support)
- **Frontend**: React + Vite (root: `client/`)
- **Claude integration**: `@anthropic-ai/claude-agent-sdk` V1 `query()` API (see ADR-007)
- **Validation**: Zod for WebSocket message schemas (see ADR-001)
- **No additional API keys needed** — the SDK wraps the local `claude` CLI binary

## Commands

```bash
bun install              # Install dependencies
bun run dev:server       # Elysia backend on 0.0.0.0:3001
bunx vite --host         # Vite frontend on :5173 (network accessible)
bun test                 # Run unit tests (bun:test)
bun run test:e2e         # Run e2e tests (Playwright)
bun run build            # Production build (Vite outputs to dist/client/)
```

Vite dev server proxies `/ws` and `/api` to Elysia backend on port 3001.

## Architecture

```
Mobile Browser (PWA) ←──WebSocket──→ Elysia Server (0.0.0.0:3001)
                                       ├─ WS Plugin (ws.ts) — Zod-validated messages
                                       ├─ Session Manager — V1 query() + resume pattern
                                       ├─ Permission Bridge — canUseTool ↔ WebSocket Promise relay
                                       ├─ Settings Loader — reads ~/.claude/ for plugins
                                       └─ Static file serving (production)
                                              ↓
                                     Claude Code CLI (local)
```

### Key Architectural Decisions

All recorded in `docs/adr/`. Key decisions:

- **V1 SDK** (ADR-007): V2 does not support plugins. V1 `query()` with resume pattern for multi-turn.
- **Plugin loading** (ADR-006): Reads `~/.claude/settings.json` + `installed_plugins.json` to pass plugin paths to SDK. `allowedTools: ["Skill"]` required.
- **Permission Bridge** (ADR-002): Promise + 60s timeout pattern. Timeout interrupts conversation.
- **Zod validation** (ADR-001): Runtime validation on WS messages, single source of truth for types.
- **Zustand + WsService** (ADR-008): Per-session state isolation via Zustand store + WebSocket singleton service.

### WebSocket Protocol

Client→Server: `new_session`, `send`, `command`, `permission`, `interrupt`, `get_server_config`, `list_sessions`, `resume_session`

Server→Client: `session_created`, `stream_chunk`, `stream_end`, `permission_request`, `capabilities`, `result`, `error`, `server_config`

Schemas defined in `server/protocol.ts`. Full spec in `claude-code-mobile.md`.

## Security Constraints

- Permission mode defaults to `"default"` — configurable via `--permission-mode` CLI flag (ADR-003)
- `CLAUDE_MOBILE_ALLOWED_ROOTS` env var restricts allowed working directories
- No auth layer on Tailscale (network membership = auth)
- If exposing via Cloudflare Tunnel, auth must be added
