# ADR-008: Zustand Store + WebSocket Service for Multi-Session

## Status
Accepted (supersedes ADR-004's MVP approach)

## Context
Phase 3 requires multi-session support — multiple sessions with different cwds, independent message histories, and tab switching. The centralized `useSocket` hook (ADR-004) manages all state in a single hook with `useState`. This doesn't scale to per-session state isolation.

ADR-004 anticipated this: "When Phase 3 (multi-session) requires it, extract WebSocket management into a Zustand store and refactor useSocket into a thin wrapper."

## Decision
Split into two layers:

### 1. WebSocket Service (`client/services/ws-service.ts`)
- Singleton class (not a hook) managing the WebSocket connection
- Handles connect, reconnect, send, and message dispatch
- Calls Zustand store actions on incoming messages
- No React dependency — pure TypeScript

### 2. Zustand Store (`client/stores/app-store.ts`)
- `sessions: Map<string, SessionState>` — per-session messages, streaming, permissions
- `activeSessionId: string | null` — which session is displayed
- `capabilities: Capabilities | null` — shared across sessions
- `connectionState: "connecting" | "connected" | "disconnected"`
- Actions: `createSession`, `setActiveSession`, `closeSession`, `addMessage`, etc.

### 3. Component Integration (direct usage)
Components use Zustand selectors and wsService directly — no intermediate hook layer needed:
- `useAppStore((s) => s.sessions.get(activeSessionId))` — read session state
- `wsService.send(sessionId, content)` — invoke actions

## Rationale
- Zustand is minimal (~1KB), no providers/context needed, works outside React (service class can call actions directly)
- Per-session state isolation is natural with `Map<sessionId, SessionState>`
- WebSocket service as a singleton avoids the "hook must be in component tree" constraint
- Components subscribe only to their slice — no unnecessary re-renders

## Migration (completed)
- Removed `useSocket` hook and `client/hooks/` directory
- Components read from Zustand store via selectors, call `wsService` methods directly
- WebSocket service initialized in `App.tsx` via `useEffect` on mount
