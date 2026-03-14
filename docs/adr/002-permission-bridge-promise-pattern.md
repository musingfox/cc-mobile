# ADR-002: Permission Bridge Using Promise + Timeout

## Status
Accepted

## Context
The SDK's `canUseTool` is an async callback that must return allow/deny. The answer comes from a user on a phone, relayed through WebSocket. We need to bridge these two async boundaries.

## Decision
Use a Promise-based bridge with a configurable timeout (default 60s). On timeout, send an interrupt (ESC) to pause the conversation rather than auto-deny.

### Mechanism
1. SDK calls `canUseTool` → create a Promise, store its resolver in `Map<requestId, resolver>`
2. Send `permission_request` to client via WebSocket
3. Client taps Approve/Deny → sends `permission` response via WebSocket
4. Look up resolver in Map, call `resolve(allow)` → Promise resolves → SDK continues

### Timeout Behavior
When 60s elapses without a response:
- Default action: interrupt the conversation (equivalent to pressing ESC)
- The conversation pauses at this point; user can still return and interact
- This is safer than auto-deny, which would silently reject and continue the turn

## Rationale
- Promise pattern is the simplest way to bridge callback ↔ async message
- `canUseTool` already returns a Promise, so the pattern is natural
- Timeout prevents indefinite hangs when the phone disconnects or user walks away
- Interrupt-on-timeout preserves conversation state, unlike auto-deny which loses context

## Alternatives Considered
- **Event emitter**: more complex, and `canUseTool` must return a Promise anyway — emitter adds indirection
- **Queue**: unnecessary since SDK calls `canUseTool` one at a time
- **No timeout**: risks permanently hanging sessions on disconnect
