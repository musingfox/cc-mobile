#!/usr/bin/env bun
/**
 * verify-stop-readback.ts — live E2E for the ADR-011 Stop-hook readback (claude v2.1.177).
 *
 * Wires the REAL pieces: response relay + /api/pty-response endpoint + PtyOrchestrator
 * + real claude via PTY. Installs a Stop hook into a temp project that POSTs back here.
 * PASS = drive() returns the reply via the Stop hook and emits a stream_chunk with it.
 *
 *   bun run docs/adr/spike-011/verify-stop-readback.ts
 */
import { PtyOrchestrator } from "../../../server/pty-orchestrator";
import { createPtyResponseRelay } from "../../../server/pty-response-relay";
import { createPtyResponseHandler } from "../../../server/pty-response-endpoint";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 39517;
const tdir = mkdtempSync(join(tmpdir(), "pty-readback-"));
mkdirSync(join(tdir, ".claude"), { recursive: true });
const stopHook = join(import.meta.dir, "..", "..", "..", "server", "pty-stop-hook.ts");
writeFileSync(
  join(tdir, ".claude", "settings.json"),
  JSON.stringify({
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `CC_MOBILE_RESPONSE_URL='http://localhost:${PORT}/api/pty-response' bun '${stopHook}'`,
            },
          ],
        },
      ],
    },
  }),
);

const relay = createPtyResponseRelay();
const handler = createPtyResponseHandler({ relay });
const server = Bun.serve({ port: PORT, fetch: (req) => handler(req) });

const orchestrator = new PtyOrchestrator();
const sessionId = crypto.randomUUID();
const emitted: Record<string, unknown>[] = [];
const t0 = Date.now();

console.log(`temp project: ${tdir}`);
console.log(`server      : http://localhost:${PORT}/api/pty-response`);
console.log("驅動真 claude（最多 ~60s）...\n");

await orchestrator.drive(
  sessionId,
  tdir,
  "Reply with exactly one word: PONG",
  (msg) => emitted.push(msg as Record<string, unknown>),
  { awaitResponseFn: (sid) => relay.awaitResponse(sid) },
);

const dt = ((Date.now() - t0) / 1000).toFixed(1);
const chunk = emitted.find((m) => m.type === "stream_chunk");
const end = emitted.find((m) => m.type === "stream_end");
const err = emitted.find((m) => m.type === "error");

let reply = "";
if (chunk) {
  const c = chunk.chunk as { message?: { content?: { text?: string }[] } };
  reply = c?.message?.content?.[0]?.text ?? "";
}

console.log(`--- 結果 (${dt}s) ---`);
console.log(`emitted types : ${emitted.map((m) => m.type).join(", ") || "(none)"}`);
console.log(`reply         : ${JSON.stringify(reply)}`);
if (err) console.log(`error         : ${JSON.stringify(err)}`);
const pass = !!chunk && !!end && reply.length > 0;
console.log(pass ? "\n✅ PASS：Stop-hook 讀回管道端到端成立" : "\n❌ FAIL");

server.stop(true);
try { rmSync(tdir, { recursive: true, force: true }); } catch {}
process.exit(pass ? 0 : 1);
