/**
 * e2e-harness.ts — the pieces every live herdr suite repeats.
 *
 * Not a test file: `bunfig.toml` excludes `server/integration/**` from
 * `bun test`, so nothing here runs in the hermetic shard. These suites only run
 * under `bun run test:herdr`, against a real daemon and a real `claude`.
 */

import { z } from "zod";

export type ServerMsg = Record<string, unknown>;

export const PaneListResultSchema = z
  .object({
    panes: z.array(z.object({ pane_id: z.string(), workspace_id: z.string() }).passthrough()),
  })
  .passthrough();

export const WorkspaceCreatedResultSchema = z
  .object({
    type: z.literal("workspace_created"),
    workspace: z.object({ workspace_id: z.string() }).passthrough(),
    root_pane: z.object({ pane_id: z.string() }).passthrough(),
  })
  .passthrough();

export const AgentStartedResultSchema = z
  .object({ type: z.literal("agent_started") })
  .passthrough();

/** Reserves a free port so the app binds a real, known number. */
export function reserveEphemeralPort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("could not reserve an ephemeral port");
  return port;
}

/**
 * Ordered consumer over the raw WebSocket, flattening the buffered
 * `{type:"event", payload}` envelope. `next` consumes in arrival order,
 * discarding non-matches, and fails with the step label on deadline.
 */
export function createMessageCollector(ws: WebSocket) {
  const messages: ServerMsg[] = [];
  let cursor = 0;
  let waiters: Array<() => void> = [];

  ws.addEventListener("message", (event) => {
    const raw = JSON.parse(String((event as MessageEvent).data)) as ServerMsg;
    const payload = raw.type === "event" ? (raw.payload as ServerMsg) : raw;
    messages.push(payload);
    const pending = waiters;
    waiters = [];
    for (const wake of pending) wake();
  });

  async function next(
    predicate: (msg: ServerMsg) => boolean,
    deadlineMs: number,
    label: string,
  ): Promise<ServerMsg> {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      while (cursor < messages.length) {
        const msg = messages[cursor];
        cursor += 1;
        if (msg && predicate(msg)) return msg;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`${label} not observed within ${deadlineMs}ms`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, Math.min(remaining, 1_000));
      });
    }
  }

  return { next, all: () => [...messages] };
}

/** Opens a client socket to a listening app and resolves once it is open. */
export async function openSocket(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("ws connection failed")));
  });
  return ws;
}

/** Concatenated text of every `text` block in a `stream_chunk`. */
export function chunkText(msg: ServerMsg): string {
  const chunk = msg.chunk as
    | { message?: { content?: Array<{ type?: string; text?: string }> } }
    | undefined;
  const content = chunk?.message?.content;
  return Array.isArray(content) ? content.map((part) => part?.text ?? "").join("") : "";
}

/** Polls `probe` until it returns true, or throws with `label` on deadline. */
export async function waitUntil(
  probe: () => Promise<boolean>,
  deadlineMs: number,
  label: string,
  pollMs = 500,
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${label} not observed within ${deadlineMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
