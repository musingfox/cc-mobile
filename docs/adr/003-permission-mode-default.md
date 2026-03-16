# ADR-003: Permission Mode Defaults to "default", Configurable Later

## Status
Accepted

## Context
cc-mobile operates remotely — users control their dev machine from a phone. The SDK supports multiple permission modes: `"default"`, `"acceptEdits"`, `"bypassPermissions"`.

## Decision
Phase 1 (MVP) hardcodes `permissionMode: "default"`. In a future phase, make it configurable via UI toggle or server startup flag.

## Rationale
- Remote operation provides less context than sitting at a terminal — every tool use should be explicitly approved by default
- Hardcoding in MVP avoids accidental bypass through client-side bugs
- Users who trust their setup (e.g., read-only review tasks) should eventually be able to relax permissions — this is a valid use case, just not MVP scope

## Future Plan
- Phase 4+: add permissionMode selector in settings UI or `--permission-mode` CLI flag at server startup
- Never allow `bypassPermissions` to be set from the WebSocket client alone — must require server-side opt-in
