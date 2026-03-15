# ADR-004: Centralized useSocket Hook for WebSocket State

## Status
Superseded by [ADR-008](008-zustand-multi-session-state.md)

## Context
The frontend needs to manage three categories of state from a single WebSocket connection:
- Connection state (connecting/connected/disconnected)
- Message stream (assistant responses, tool use notifications)
- Permission requests (pending approval/denial)

## Decision
Use a single custom React hook `useSocket()` that owns the WebSocket connection and exposes all related state and actions.

## Rationale
- All three state categories share one WebSocket connection and are interdependent:
  - Disconnect → clear pendingPermission (server-side Promise will timeout)
  - stream_end → update messages + toggle streaming flag
  - permission_request → update pendingPermission + may affect stream UI
- Splitting into `useMessages()` + `usePermission()` + `useConnection()` would require sharing the WebSocket instance and synchronizing state across hooks — more complex for no benefit at MVP scale
- A single hook keeps App.tsx clean: `const { messages, send, pendingPermission } = useSocket()`

## Alternatives Considered
- **Zustand global store + WebSocket service class**: appropriate for Phase 3 (multi-session) but over-engineering for MVP with one session
- **Multiple hooks sharing a context**: adds Provider boilerplate, same coupling with more indirection

## Migration Path
When Phase 3 (multi-session) requires it, extract WebSocket management into a Zustand store and refactor useSocket into a thin wrapper.
