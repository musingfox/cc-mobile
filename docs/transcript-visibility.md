# Transcript visibility

The session view is the union of two exclusion layers that do not share a unit of analysis, so they cannot honestly be collapsed into one flat list.

**L1 (server, record-unit)** exists because some JSONL lines are not conversation at all: a whole record is dropped before it is ever a `stream_chunk`. Record-unit is the only scale at which `isSidechain` / `isMeta` / `isCompactSummary` and the type/role whitelist can speak.

**L2 (client, block-unit)** exists because one conversational record can mix thinking, tool plumbing and answer text — omp writes `thinking + text` in one content array — so a record-unit rule cannot drop thinking without also dropping the answer. Hidden reasoning is kept intact by the server on purpose; the client then decides, per reading mode, whether that block is content. That is not a server exclusion.

Reading modes are a client projection over L2. They do not change L1, and they do not change ADR-015 decision M1 (the server still passes blocks through, including types it has never seen).

## L1 — server-record (`server/transcript/records.ts`)

| id | When it fires |
| --- | --- |
| `L1-isSidechain` | `isSidechain === true` |
| `L1-isMeta` | `isMeta === true` |
| `L1-isCompactSummary` | `isCompactSummary === true` |
| `L1-claude-type-not-user-assistant` | claude `type` is not `user` or `assistant` |
| `L1-omp-type-not-message` | omp `type` is not `"message"` |
| `L1-omp-role-not-user-assistant` | omp `type` is `"message"` but `role` is not `user` or `assistant` |
| `L1-conversational-no-message-body` | conversational record with no `message` object |

## L2 — client-block (`projectChunk`)

| id | Block | Conversation | Full |
| --- | --- | --- | --- |
| `L2-text` | `text` | visible | visible |
| `L2-thinking` | `thinking` | hidden | visible |
| `L2-tool_use` | `tool_use` | hidden | visible |
| `L2-tool_result` | `tool_result` | hidden | visible |
| `L2-command-wrappers` | `<command-name>` / `<local-command-stdout>` | hidden | hidden |
| `L2-unrecognised-block` | unrecognised `type` | hidden | hidden |
