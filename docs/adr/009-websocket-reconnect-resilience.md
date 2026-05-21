# ADR-009: WebSocket Reconnect Resilience

## Status

Accepted

## Context and Problem Statement

Mobile browsers suspend or kill WebSocket connections when the app is backgrounded. When the user returns to cc-mobile, the connection is re-established (exponential backoff), but messages produced by Claude Code during the disconnection are permanently lost. This makes cc-mobile unreliable for any interaction where the user might briefly switch apps.

## Decision Drivers

- Mobile Safari/Chrome aggressively suspend background tabs (WebSocket killed after ~5s–30s)
- Claude Code sessions continue running server-side regardless of client connection
- Permission prompts during disconnection timeout after 60s, interrupting the conversation
- Single-user PWA on a dev machine — solution should be simple, not production-grade distributed

## Decision

Implement a three-layer reconnect resilience mechanism:

### 1. Server-Side Event Buffer (In-Memory Ring Buffer)

- All server→client messages with a `sessionId` are wrapped in an event envelope: `{ type: "event", eventId, sessionId, payload }`
- `EventBuffer` stores up to 500 events per session in a ring buffer
- On client reconnect, the server replays missed events based on `lastEventId`
- Gap detection: if `lastEventId` is older than the oldest buffered event, the client is notified

### 2. Client Auto-Reconnect with Heartbeat

> Superseded: ping/pong application heartbeat was removed and replaced by Bun protocol-level keep-alive (`sendPings: true`, `idleTimeout: 240`).

- Existing exponential backoff reconnect (1s → 30s) is retained
- Server sends `{ type: "ping" }` every 30s; client responds with `{ type: "pong" }`
- If no pong within 10s, server closes the connection (triggers client reconnect)
- `LifecycleManager` triggers reconnect on `visibilitychange` (app foreground) if WebSocket is closed
- `lastEventId` persisted to `localStorage` for cross-reload resilience

### 3. Permission Pause/Resume

- On WebSocket close, pending permission timeouts are paused (snapshots captured)
- On reconnect, the same permission handler is reused (promises still pending for SDK)
- Timeouts resume with remaining time; permission_request re-sent to client
- If remaining time ≤ 0 on resume, permission is denied immediately

## Consequences

### Good

- User can background the app and return to see complete output
- Permission prompts survive brief disconnections
- Zero configuration — works automatically
- Backward compatible — no protocol breaking changes for existing clients

### Bad

- In-memory buffer lost on server restart (acceptable for single-user dev tool)
- 500-event buffer may not cover very long disconnections (graceful degradation with gap warning)
- All session-scoped messages now have event wrapper overhead (minimal — one extra JSON level)

## Alternatives Considered

- **Disk-backed buffer**: Survives restart but adds I/O complexity. Rejected: single-user PWA, restart = acceptable loss.
- **Server-Sent Events (SSE)**: Native retry/lastEventId support, but would require replacing WebSocket (bidirectional needed for permission responses).
- **Service Worker reconnect**: Could maintain connection in background, but adds deployment complexity and doesn't solve buffer problem.

## Technical Details

### New Protocol Messages

Client → Server:
- `reconnect { lastEventId: number | null, sessionIds: string[] }`
- `pong {}`

Server → Client:
- `event { eventId: number, sessionId: string, payload: ServerMessage }`
- `replay_complete { sessionId: string, eventsReplayed: number, gapDetected: boolean }`
- `ping { timestamp: number }`

### Files Changed

- `server/event-buffer.ts` (new) — Ring buffer implementation
- `server/heartbeat.ts` (new) — Ping/pong manager
- `server/protocol.ts` — New message schemas
- `server/permission-bridge.ts` — Pause/resume methods
- `server/ws.ts` — Event wrapping, replay handler, heartbeat integration
- `client/services/ws-service.ts` — Event unwrapping, reconnect message, pong response
- `client/services/lifecycle-manager.ts` — Visibility restore callback
- `client/App.tsx` — Lifecycle reconnect wiring
