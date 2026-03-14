# ADR-005: Elysia WebSocket Handler as Plugin

## Status
Accepted

## Context
The WebSocket handler contains significant logic (message dispatch, session management integration, permission relay). The server entry point also handles static file serving and REST endpoints.

## Decision
Export the WebSocket handler from `ws.ts` as an Elysia plugin, mounted in `index.ts` via `.use()`.

## Rationale
- **Testability**: the WS plugin can be mounted on a test Elysia instance without starting the full server
- **Separation of concerns**: `index.ts` handles server lifecycle; `ws.ts` handles WebSocket protocol
- **Extensibility**: Phase 2 REST endpoints and future plugins follow the same `.use()` pattern

## Alternatives Considered
- **Inline in index.ts**: simpler initially but becomes unwieldy as the WS handler grows (10+ message types)
