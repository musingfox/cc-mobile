# ADR-007: Use V1 query() API Instead of V2 createSession()

## Status
Accepted (supersedes initial plan's V2 preference)

## Context
The initial plan chose V2 `unstable_v2_createSession()` because its `send()`/`stream()` pattern maps cleanly to WebSocket request/response. However, during implementation we discovered V2 does not support the `plugins` option — installed plugins, their skills, agents, and slash commands are not loaded.

V1 `query()` loads all 16 enabled plugins (52 slash commands, 26 skills) correctly. V2 loads zero.

### V1 vs V2 Feature Comparison

| Capability | V1 `query()` | V2 `unstable_v2_createSession()` |
|---|---|---|
| Plugin loading | Full support | Not supported |
| Capabilities query | `supportedCommands()`, `supportedAgents()`, `supportedModels()` | None |
| API stability | Stable | `unstable_` prefix, preview |
| Multi-turn pattern | Async generator (must keep alive across turns) | Explicit `send()`/`stream()` per turn |

## Decision
Use V1 `query()` as the SDK interface. Encapsulate SDK interaction behind SessionManager's interface so switching to V2 later requires only internal changes.

## Rationale
- V2 cannot load plugins — this is a blocking gap for cc-mobile's goal of full Claude Code parity
- V1 is the stable, fully-featured API with no indication of deprecation
- The async generator pattern is more complex to map to WebSocket, but manageable within session-manager
- V2 is expected to eventually support plugins, but no timeline exists

## Migration Path
When V2 adds plugin support, replace session-manager internals from V1 `query()` to V2 `createSession()`. The SessionManager interface (`createSession`, `sendMessage`, `destroySession`) and all consumers (ws.ts, frontend) remain unchanged.
