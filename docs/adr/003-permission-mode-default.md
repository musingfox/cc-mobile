# ADR-003: Permission Mode Defaults to "default", Configurable Later

## Status
Superseded (2026-08-06) — cc-mobile no longer decides an agent's permission mode
at all. See "Superseded by" below and ADR-015's 2026-08-06 section.

## Context
cc-mobile operates remotely — users control their dev machine from a phone. The SDK supports multiple permission modes:
- `"default"` — ask for permission on each tool use
- `"acceptEdits"` — auto-approve file edits, ask for others
- `"auto"` — auto-approve common operations, ask for risky ones
- `"plan"` — require plan approval before implementation
- `"dontAsk"` — never ask, deny instead of prompting (CI/non-interactive)
- `"bypassPermissions"` — auto-approve everything

## Decision
Phase 1 (MVP) hardcodes `permissionMode: "default"`. In a future phase, make it configurable via UI toggle or server startup flag.

## Rationale
- Remote operation provides less context than sitting at a terminal — every tool use should be explicitly approved by default
- Hardcoding in MVP avoids accidental bypass through client-side bugs
- Users who trust their setup (e.g., read-only review tasks) should eventually be able to relax permissions — this is a valid use case, just not MVP scope

## Future Plan
- Phase 4+: add permissionMode selector in settings UI or `--permission-mode` CLI flag at server startup
- Never allow `bypassPermissions` to be set from the WebSocket client alone — must require server-side opt-in

## Superseded by: cc-mobile does not set an agent's mode (2026-08-06)

The decision this ADR postponed — "make it configurable later" — was answered
the other way: **nothing** here is configurable from cc-mobile, because cc-mobile
stopped deciding it. `--permission-mode` is no longer passed to `claude`, the
`--permission-mode` CLI flag is gone, and the WS messages that pretended to
adjust it (`set_permission_mode`, and its `set_model` / `set_effort` /
`set_env_vars` siblings) are refused by the Zod gate.

What replaced it: each agent runs at whatever its own settings say, exactly as
it would if the user had started it in their own terminal. That is the North
Star property this project is built around — one live session shared between
terminal and phone — and a mode cc-mobile imposed at launch was a way the two
could differ.

The reasoning in "Rationale" above still holds; what changed is where it
applies. "Every tool use should be explicitly approved by default" is claude's
own default when no flag is passed, so the posture is unchanged for anyone who
has not deliberately configured otherwise — and if they have, that is their
setting to hold. The last line of "Future Plan" survives in a stronger form:
the client cannot set `bypassPermissions`, because the client cannot set
anything.

What remains is **disclosure, not control**: `sessions[].gated` still reads the
pane's own argv (`--permission-mode` for claude, `--approval-mode` for omp) and
badges a session that runs ungated. Reading someone else's flag is not setting
it.
