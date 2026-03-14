# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Touch — a touch-optimized PWA for interacting with Claude Code from phones/tablets. Runs on the dev machine, accessed via Tailscale or local network. Translates terminal interactions (permission prompts, slash commands, agent invocations) into tap-friendly UI elements.

## Tech Stack

- **Runtime**: Bun
- **Backend**: Elysia (Bun-native server with native WebSocket support)
- **Frontend**: React + Vite
- **Claude integration**: `@anthropic-ai/claude-agent-sdk` (V2 API preferred, V1 as fallback)
- **No additional API keys needed** — the SDK wraps the local `claude` CLI binary

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Dev server (Vite frontend + Elysia backend)
bun run build        # Production build (Vite outputs to dist/client/)
```

Vite dev server proxies `/ws` (WebSocket) and `/api` to Elysia backend on port 3001.

## Architecture

```
Mobile Browser (PWA) ←──WebSocket──→ Elysia Server (port 3001)
                                       ├─ WebSocket handler (ws.ts) — schema-validated messages
                                       ├─ Session Manager — multi-session lifecycle via V2 SDK
                                       ├─ Permission Bridge — relays canUseTool ↔ WebSocket
                                       └─ Static file serving (production)
                                              ↓
                                     Claude Code CLI (local)
```

### Key Architectural Decisions

- **V2 SDK (`unstable_v2_createSession`)**: Its `send()`/`stream()` pattern maps cleanly to WebSocket request/response. V2 sessions keep the `canUseTool` callback alive across turns, unlike V1 where the async generator must stay alive.
- **Elysia over raw Bun.serve**: The WebSocket protocol has 10+ message types. Elysia provides schema validation on WS messages, typed `ws.data` context, and declarative routing.
- **Permission Bridge pattern**: SDK's `canUseTool` callback creates a Promise per tool use, WebSocket client resolves it via `permission` message. This is the critical bridge between SDK and touch UI.

### WebSocket Protocol

Client→Server message types: `message`, `command`, `permission`, `session.create`, `session.list`, `session.close`, `capabilities`, `interrupt`

Server→Client message types: `assistant`, `stream`, `tool_use`, `tool_summary`, `permission_request`, `result`, `error`, `session`, `capabilities`

Full protocol spec is in `cc-touch.md`.

## Security Constraints

- Permission mode is always `"default"` — every tool use requires explicit phone approval
- Never set `bypassPermissions` — interactive control is the core purpose
- No auth layer when using Tailscale (network membership = auth)
- If exposing via Cloudflare Tunnel, auth must be added
