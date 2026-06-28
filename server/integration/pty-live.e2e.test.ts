import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSpawner, type SpawnerFn } from "../pty-driver";
import { PtyOrchestrator } from "../pty-orchestrator";
import { createPtyResponseHandler } from "../pty-response-endpoint";
import { createPtyResponseRelay } from "../pty-response-relay";
import { stripAnsi } from "../tui-readiness";

const LIVE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = LIVE_TIMEOUT_MS + 10_000;
const claudePath = Bun.which("claude");

let tempProject: string | undefined;
let liveServer: Server | undefined;

interface StreamChunkMessage {
  type: "stream_chunk";
  sessionId: string;
  chunk: {
    message?: {
      role?: string;
      content?: Array<{ text?: string }>;
    };
  };
}

interface StreamEndMessage {
  type: "stream_end";
  sessionId: string;
}

type EmittedMessage = StreamChunkMessage | StreamEndMessage | Record<string, unknown>;

function makeClaude2179ReadySpawner(): SpawnerFn {
  return (args, cwd) => {
    const proc = defaultSpawner(args, cwd);
    return {
      ...proc,
      onData: (cb) => {
        proc.onData((chunk) => {
          const readyCompatChunk = stripAnsi(chunk).includes("ClaudeCode")
            ? `${chunk}\nClaude Code\n`
            : chunk;
          cb(readyCompatChunk);
        });
      },
    };
  };
}

function makeTempProject(responseUrl: string): string {
  const projectDir = mkdtempSync(join(process.cwd(), ".tmp-pty-live-"));
  mkdirSync(join(projectDir, ".claude"), { recursive: true });

  const stopHook = join(process.cwd(), "server", "pty-stop-hook.ts");
  writeFileSync(
    join(projectDir, ".claude", "settings.json"),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `CC_MOBILE_RESPONSE_URL='${responseUrl}' bun '${stopHook}'`,
              },
            ],
          },
        ],
      },
    }),
  );

  return projectDir;
}

async function pgrepClaudeSession(sessionId: string): Promise<string> {
  const proc = Bun.spawn(["pgrep", "-f", `claude --session-id ${sessionId}`], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

async function expectNoClaudeProcess(sessionId: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let stdout = "";

  do {
    stdout = await pgrepClaudeSession(sessionId);
    if (stdout.length === 0) {
      expect(stdout).toBe("");
      return;
    }
    await Bun.sleep(100);
  } while (Date.now() < deadline);

  expect(stdout).toBe("");
}

afterEach(() => {
  liveServer?.stop(true);
  liveServer = undefined;

  if (tempProject) {
    rmSync(tempProject, { recursive: true, force: true });
    tempProject = undefined;
  }
});

test.skipIf(!claudePath)(
  "live PTY drive emits an assistant chunk, stream_end, and leaves no claude process behind",
  async () => {
    const relay = createPtyResponseRelay({ timeoutMs: LIVE_TIMEOUT_MS });
    const handler = createPtyResponseHandler({ relay });
    liveServer = Bun.serve({ port: 0, fetch: (req) => handler(req) });

    tempProject = makeTempProject(`http://127.0.0.1:${liveServer.port}/api/pty-response`);

    const orchestrator = new PtyOrchestrator({ timeout: LIVE_TIMEOUT_MS });
    const sessionId = crypto.randomUUID();
    const emitted: EmittedMessage[] = [];
    const startedAt = Date.now();

    await orchestrator.drive(
      sessionId,
      tempProject,
      "Reply with exactly one word: PONG",
      (msg) => emitted.push(msg as EmittedMessage),
      {
        spawner: makeClaude2179ReadySpawner(),
        awaitResponseFn: (sid) => relay.awaitResponse(sid),
      },
    );

    expect(Date.now() - startedAt).toBeLessThanOrEqual(LIVE_TIMEOUT_MS);

    const chunkIndex = emitted.findIndex((msg): msg is StreamChunkMessage => {
      if (msg.type !== "stream_chunk") return false;
      return msg.chunk?.message?.role === "assistant";
    });
    const endIndex = emitted.findIndex((msg): msg is StreamEndMessage => msg.type === "stream_end");

    expect(chunkIndex).toBeGreaterThanOrEqual(0);
    expect(endIndex).toBeGreaterThan(chunkIndex);

    const assistantChunk = emitted[chunkIndex] as StreamChunkMessage;
    const firstText = assistantChunk.chunk.message?.content?.[0]?.text ?? "";
    expect(firstText.length).toBeGreaterThan(0);

    await expectNoClaudeProcess(sessionId);
  },
  TEST_TIMEOUT_MS,
);
