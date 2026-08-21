[/tmp/cf-0821-5ZHB/shards/D/work/cc-mobile.md#D654]
1:# CCMobile — Plan Document
2:
3:> Touch-optimized web UI for Claude Code, designed for phones and tablets.
4:> Not a terminal replacement — a touch translation of terminal interactions.
5:
6:## Problem
7:
8:Claude Code is a powerful terminal tool, but mobile/tablet interaction is painful:
9:- Terminal apps (Termius, Blink) require keyboard-heavy input
10:- Permission prompts need typing y/n
11:- Slash commands and agent names are hard to type on touch
12:- No way to quickly trigger common workflows
13:
14:## Solution
15:
16:A PWA that runs on the dev machine, accessible via Tailscale/local network. It connects to Claude Code via the official Agent SDK, translating terminal interactions into touch-friendly UI elements:
17:- Permission prompts → tap Approve/Deny buttons
18:- Slash commands → quick action buttons
19:- Agent invocations → one-tap agent cards
20:- Text input → optional, with voice input support
21:
22:## Architecture
23:
24:```
25:┌─────────────────┐         ┌───────────────────────────────┐
26:│  Mobile Browser  │◄──WS──►│  Elysia (Bun-native)          │
27:│  (PWA)           │         │    ├─ Native WebSocket (.ws()) │
28:│                  │         │    ├─ Session Manager           │
29:│  - Chat view     │         │    │   ├─ Session A (cwd: /p1) │
30:│  - Quick actions │         │    │   └─ Session B (cwd: /p2) │
31:│  - Permissions   │         │    └─ SDK Bridge               │
32:│  - Session tabs  │         │        └─ @anthropic-ai/       │
33:└─────────────────┘         │           claude-agent-sdk      │
34:                            └───────────────────────────────┘
35:                                        │
36:                                        ▼
37:                              Claude Code CLI (local)
38:                              Uses existing ANTHROPIC_API_KEY
39:```
40:
41:### SDK API Choice — V1 `query()` (see [ADR-007](docs/adr/007-use-v1-query-api.md))
42:
43:The SDK offers V1 `query()` (stable) and V2 `unstable_v2_createSession()` (preview). This project uses **V1** because V2 does not support the `plugins` option — installed plugins, skills, and agents are not loaded.
44:
45:V1 uses an async generator pattern with a **resume model** for multi-turn:
46:1. First turn: `query({ prompt, options })` → iterate generator → close
47:2. Subsequent turns: `query({ prompt, options: { resume: sessionId } })` → iterate → close
48:
49:Each turn creates a fresh `query()` with `resume` pointing to the SDK session ID captured from the system init message.
50:
51:## Dependencies
52:
53:| Package | Purpose |
54:|---------|---------|
55:| `elysia` | Bun-native server — routing, WebSocket (native), schema validation |
56:| `zod` | Runtime validation for WebSocket messages (see [ADR-001](docs/adr/001-zod-runtime-validation.md)) |
57:| `react` + `react-dom` | Frontend UI |
58:| `vite` | Frontend build + dev server |
59:
60:**Why Elysia over raw Bun.serve** (see [ADR-005](docs/adr/005-elysia-ws-plugin-pattern.md)): This project's WebSocket protocol has 10+ message types. Elysia provides declarative routing and plugin architecture. WS handler is exported as an Elysia plugin from `ws.ts`, mounted via `.use()` in `index.ts` for testability and separation of concerns.
61:
62:**No additional API keys or LLM services required.** The SDK wraps the locally installed `claude` CLI binary and uses the existing `ANTHROPIC_API_KEY`.
63:
64:## WebSocket Protocol
65:
66:All messages are Zod-validated (see [ADR-001](docs/adr/001-zod-runtime-validation.md)). Schemas defined in `server/protocol.ts`.
67:
68:### Client → Server
69:
70:```typescript
71:{ type: "terminal_create", claudeUuid: string, cwd: string, agentKind?: "claude" | "omp" }
72:{ type: "terminal_send", claudeUuid: string, content: string }
73:{ type: "terminal_teardown", claudeUuid: string }
74:{ type: "list_terminal_sessions" }
75:{ type: "permission", requestId: string, allow: boolean, answers?: Record<string, string> }
76:{ type: "interrupt", sessionId: string }
77:{ type: "stop_task", sessionId: string, taskId: string }
78:{ type: "get_server_config" }
79:{ type: "transcript_page_request", sessionId: string,
80:  before?: { epoch: string, seq: number, recordId: string } }
81:```
82:
83:Refused by the Zod gate with `{code:"invalid_message"}`: `set_permission_mode`,
84:`set_model`, `set_effort` and `set_env_vars` — the agent-settings controls,
85:removed once it was settled that an agent's mode, model and effort are the
86:agent's own settings and not cc-mobile's to decide (ADR-003 superseded) — plus
87:`list_sessions`,
88:`resume_session` and `set_session_title` (removed in #26 with the whole
89:browse-past-conversations path), plus #25's `new_session`, `send`, `command`,
90:`pty_send`, `get_session_info` and the `tmux_*` names that `terminal_*`
91:replaced. There is no compatibility window — a cached PWA bundle recovers with
92:a page reload.
93:
94:### Server → Client
95:
96:```typescript
97:{ type: "stream_chunk", sessionId: string, chunk: Record<string, unknown> }
98:{ type: "stream_end", sessionId: string }
99:{ type: "permission_request", sessionId: string, requestId: string,
100:  tool: { name: string, parameters: Record<string, unknown> } }
101:{ type: "capabilities", sessionId: string, commands: string[], agents: string[], model: string }
102:{ type: "terminal_created", claudeUuid: string, terminalName: string, paneRef: string }
103:{ type: "terminal_teardown_result", claudeUuid: string, killed: boolean }
104:{ type: "terminal_sessions",
105:  sessions: { sessionId: string, agent?: string, agentSessionValue: string | null,
106:              cwd: string, origin: "self" | "foreign", drivable: boolean,
107:              readable: boolean, gated: boolean,
108:              state?: "idle" | "running" | "requires_action" }[],
109:  claudeUuids: string[],
110:  states?: Record<string, "idle" | "running" | "requires_action"> }
111:{ type: "session_state", sessionId: string, state: "idle" | "running" | "requires_action" }
112:{ type: "error", code: string, message: string, sessionId?: string } // agent_blocked_notice: fenced blocked-screen words; agent_attention_notice: claude trust dialog while herdr says idle — read-only, no keys
113:{ type: "server_config", config: { allowedRoots?: string[] | null, homeDirectory?: string,
114:                                  availableAgents?: ("claude"|"omp")[] } }
115:{ type: "transcript_page", sessionId: string, epoch: string,
116:  records: Record<string, unknown>[],
117:  nextBefore: { epoch: string, seq: number, recordId: string } | null }
118:```
119:
120:`transcript_page_request` / `transcript_page` are the history pull: the phone
121:asks a live session for one page of its own backlog and gets it outside the live
122:stream. The reply goes out with a bare `ws.send`, so it is never wrapped in an
123:`event` envelope and never replayed on reconnect — it answers one connection's
124:question, not the session's.
125:
126:There is no page size on the wire; the server owns that number (50 records).
127:The page unit is "records the mapper keeps", not "records the phone renders", so
128:a page of tool plumbing can legitimately produce no visible bubbles — deciding
129:what is visible stays the client's job (ADR-015 M1), and the bodies in `records`
130:come out of the same `transcriptRecordToChunk` the live path uses.
131:
132:`before` is the cursor the server last handed back, and it is a receipt, not just
133:a position: it names the file (`epoch`) and the record it stops before (`seq` +
134:`recordId`). The server re-proves both against the file the path resolves to
135:*now*, because a terminal `/clear` rotates that file underneath the phone. A
136:cursor from a retired epoch, one whose byte offset now holds a different record,
137:or one past EOF is not an error — it degrades to the newest page of the current
138:file, and the reply's own `epoch` says so. `nextBefore: null` means the
139:conversation starts at this page.
140:
141:`epoch` is never empty and never a placeholder: a session that is not listed, has
142:no transcript key, or runs a kind with no registered reader gets
143:`{code:"transcript_unavailable"}` instead of a page. Every `stream_chunk.chunk`
144:carries the same `epoch`, plus `recordId` and `seq`, so the phone can tell a live
145:chunk and a page entry apart from a *different* conversation.
146:
147:`server_config` now carries only what the server knows and the client cannot:
148:which paths are allowed, where `$HOME` is, and which agents this machine can
149:launch. The `permissionMode` / `model` / `effort` fields went with the messages
150:that set them.
151:
152:`availableAgents` (#31) names the kinds this machine can launch — a
153:`LAUNCHABLE_AGENT_KINDS` entry whose binary is on `PATH`. A kind missing from it
154:is missing from the phone's new-session choice, which is the whole point: naming
155:an unavailable kind would start a pane that dies immediately.
156:
157:Note the asymmetry with `sessions[].agent`, which stays a free string: that one
158:is **inbound** — herdr's own label, whose vocabulary grows between versions, so
159:an unknown value must survive. `agentKind` is **outbound** into something herdr
160:execs, so it is a closed enum and an unlisted kind is refused with
161:`invalid_message` before any workspace is created.
162:
163:`terminal_sessions` doubles as the status bootstrap: `states` carries what herdr
164:says each live session is doing, read from one `session.snapshot` call. It is
165:optional — a daemon hiccup degrades it to `{}` rather than failing the reply —
166:and a pane id absent from the map means "no claim", never "idle". `claudeUuids`
167:mirrors `sessions[].sessionId`; the name is outdated (they are pane ids of every
168:kind of agent since #30) and kept so a cached bundle keeps reconciling.
169:`unknownUuids` was removed in #29 with the startup remount scan that produced it.
170:`session_created`, `session_list` and `session_history` were removed in #26 and
171:are refused.
172:
173:`sessions[]` lists **every** pane herdr's `agent.list` returns, whatever kind of
174:agent is running in it (#30). `agent` is the kind herdr detected, passed through
175:verbatim — no enum and no normalisation, because the daemon's label vocabulary is
176:its own and grows between versions, and a label this build has not heard of must
177:not fail the parse. **An absent `agent` means herdr has not detected a kind yet;
178:it must never be read as claude.** The value is snapshot-time: no message ever
179:pushes a kind on its own, so a detection that completes later reaches the client
180:only when it asks for the list again (i.e. on reconnect).
181:
182:`readable:true` means the session has a transcript key, its kind has a
183:registered transcript reader (claude and omp since #32), **and** — when the key
184:is a path rather than an id — the file that path names exists. Like `gated` it is
185:disclosure only — nothing refuses to drive, read back or ask permission because
186:it is `false`, and `drivable` stays `true` for every kind.
187:
188:That last check is the one flag here that legitimately changes for a pane that
189:did not change. herdr reports omp's transcript **path** (`agent_session.kind ===
190:"path"`, only `pi` and `omp` get one) the moment the agent launches, but omp
191:creates the file when the first turn starts — a fresh omp nobody has spoken to
192:has a key and no file for as long as it stays quiet (probe 2026-08-06: still
193:absent after 120s idle). So a new omp lists unreadable, and the same pane lists
194:readable once it has said something. claude's `id` key is not checked the same
195:way: answering it means `resolveTranscriptPath`'s directory scan, on every
196:listing for every pane, for an answer that is always yes by the time an id
197:exists.
198:
199:The key kind is server-side only — `ws.ts` projects the wire fields by name, so
200:`agentSessionKind` never reaches the phone.
201:
202:Note: `stream_chunk.chunk` contains raw claude message objects (e.g., `{ type: "assistant", message: { content: [...] } }`) plus the three keys the server stamps on: `recordId` (the record's own `uuid`/`id`, absent when it has neither), `seq` (its absolute byte offset in the transcript — the only total order the data supports, since timestamps tie and invert) and `epoch` (16 hex chars naming the file). The frontend's `extractTextFromChunk()` parses these into displayable text. omp's records are mapped into that same envelope by `server/transcript/records.ts` — one mapper reads both vocabularies, since they do not overlap (omp puts every conversational record under `type:"message"` with the role inside; claude uses the role as the type) and which file is read…
203:
204:## Project Structure
205:
206:```
207:cc-mobile/
208:├── package.json
209:├── tsconfig.json
210:├── vite.config.ts
211:├── docs/adr/                    # Architecture Decision Records
212:├── server/
213:│   ├── index.ts                 # Elysia app entry, listens on 0.0.0.0:3001
214:│   ├── config.ts                # CLI flag + env var parsing
215:│   ├── ws.ts                    # WebSocket handler as Elysia plugin (ADR-005)
216:│   ├── session-manager.ts       # Session map + settings state (no turn driver)
217:│   ├── terminal-control.ts      # terminal_create / terminal_teardown handlers
218:│   ├── claude-settings.ts       # Builds the --settings file that injects hooks
219:│   ├── herdr/                   # herdr socket backend (ADR-015)
220:│   ├── pty-permission-relay.ts  # PreToolUse hook ↔ WebSocket, 90s deny (ADR-002/014)
221:│   ├── pty-response-relay.ts    # Stop hook ↔ WebSocket readback (ADR-011)
222:│   ├── session-listing.ts       # List resumable sessions per project
223:│   ├── session-history.ts       # Session message history
224:│   ├── protocol.ts              # Zod schemas for WS messages (ADR-001)
225:│   └── __tests__/               # Bun test files
226:├── client/
227:│   ├── index.html               # PWA shell
228:│   ├── tsconfig.json            # Frontend-specific TS config
229:│   ├── main.tsx                 # React entry
230:│   ├── App.tsx                  # Layout: status bar + chat + quick actions + input
231:│   ├── styles.css               # Mobile-first CSS with dark/light/Claude themes
232:│   ├── components/
233:│   │   ├── ChatView.tsx         # Message list, auto-scroll, typing indicator
234:│   │   ├── InputBar.tsx         # Text input + autocomplete for / and @
235:│   │   ├── QuickActions.tsx     # Pinned command/agent buttons
236:│   │   ├── PickerPanel.tsx      # Full command/agent search panel
237:│   │   ├── PermissionBar.tsx    # Approve/Deny sticky bar (48px+ targets)
238:│   │   ├── SessionTabs.tsx      # Multi-session tab switching
239:│   │   ├── SessionListModal.tsx # Resume previous sessions
240:│   │   ├── ActivityPanel.tsx    # Live tool/agent status display
241:│   │   ├── StatusBar.tsx        # Cost, tokens, turns display
242:│   │   └── Settings.tsx         # Settings modal
243:│   ├── stores/
244:│   │   ├── app-store.ts         # Zustand: sessions, messages, permissions
245:│   │   └── settings-store.ts    # Zustand: defaultCwd, theme
246:│   ├── services/
247:│   │   ├── ws-service.ts        # WebSocket singleton (ADR-008)
248:│   │   ├── settings.ts          # localStorage persistence
249:│   │   ├── projects.ts          # Saved projects persistence
250:│   │   ├── pins.ts              # Pin management
251:│   │   └── tool-events.ts       # Tool event processing
252:│   └── __tests__/               # Frontend unit tests
253:└── public/                      # (Future: PWA manifest, icons)
254:```
255:
256:## Key Implementation Details
257:
258:### 1. Session Manager — session map + settings state
259:
260:The in-process `query()` turn driver was removed in #25 (ADR-015). Turns are
261:driven by the herdr backend; `SessionManager` now holds only the session map —
262:the settings state went with the messages that wrote it. That map has had no
263:writer since #26 deleted the resume handler, so every session-scoped message
264:(`append_user_message`) answers `session_not_found`, and `interrupt` is a silent
265:no-op.
266:
267:```typescript
268:class SessionManager {
269:  async createSession(sessionId, cwd, sdkSessionId?): Promise<void>;
270:  destroySession(sessionId): void;  // drops the entry, cleans up uploads
271:}
272:```
273:
274:Browsing past conversations is gone since #26. herdr's live sessions are the
275:only sessions there are: the Projects screen lists saved projects, its activity
276:dot reflects the state herdr reports, and a project with nothing live shows no
277:dot at all.
278:
279:### 2. Plugin Loading ([ADR-006](docs/adr/006-plugin-loading-from-user-settings.md))
280:
281:No longer done by this server. The `claude` process herdr starts reads
282:`~/.claude` itself, so `settings-loader.ts` was deleted in #25 along with the
283:`query()` call whose `plugins` option was its only consumer.
284:
285:### 3. Permission Relay — Promise + Timeout ([ADR-002](docs/adr/002-permission-bridge-promise-pattern.md))
286:
287:The PreToolUse hook inside the pane POSTs to `/api/pty-permission`; the server
288:holds that HTTP request open, asks the phone over the WebSocket, and answers
289:with the user's decision. Unanswered after 90s → deny (#24). The Promise +
290:timeout shape is ADR-002's; the entry point is HTTP rather than `canUseTool`.
291:
292:### 4. Quick Actions
293:
294:**Frozen since #25**: the slash-command and agent lists came from the SDK's
295:`system`/`init` message, so nothing writes the on-disk cache any more. A machine
296:with a pre-#25 cache shows a stale list; one without shows an empty picker.
297:Frontend features:
298:- **Pinnable commands** — user pins frequently used commands to a compact bar (persisted in localStorage)
299:- **Input autocomplete** — typing `/` or `@` in InputBar filters matching commands/agents
300:
…
370:
…
519:- [npm: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

[Showing lines 1-300 of 519. Use :301 to continue. Some lines truncated to 768 chars]