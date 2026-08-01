import { expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { z } from "zod";
import { createHerdrClient, SUPPORTED_PROTOCOL } from "../herdr/client";
import { HerdrRpcError } from "../herdr/errors";
import { type EventEnvelope, OkResultSchema } from "../herdr/schema";
import type { SubscriptionHandle } from "../herdr/subscribe";
import { resolveSocketPath } from "../herdr/transport";

// Live smoke against a real herdr daemon — the Done criterion for issue #20:
// full scratch-pane lifecycle (create -> send -> event -> read -> cleanup)
// plus the agent_not_found error shape on an agent-less pane. Only touches a
// dedicated scratch workspace; user panes/sessions are never targeted.

const socketPath = resolveSocketPath();
const MARKER = "HERDR_SMOKE_OK";
const EVENT_DEADLINE_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

const WorkspaceCreatedResultSchema = z
  .object({
    type: z.literal("workspace_created"),
    workspace: z.object({ workspace_id: z.string() }).passthrough(),
    root_pane: z.object({ pane_id: z.string() }).passthrough(),
  })
  .passthrough();

const PaneListResultSchema = z
  .object({
    panes: z.array(z.object({ workspace_id: z.string() }).passthrough()),
  })
  .passthrough();

function withinMs<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} not observed within ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

it.skipIf(!existsSync(socketPath))(
  "live herdr smoke: pane lifecycle round-trips and agent methods reject on agent-less panes",
  async () => {
    const client = createHerdrClient({ socketPath });

    // 1. Protocol pin: an incompatible daemon fails here, not mid-sequence.
    const pong = await client.assertCompatible();
    expect(pong.protocol).toBe(SUPPORTED_PROTOCOL);

    let workspaceId: string | undefined;
    let subscription: SubscriptionHandle | undefined;
    try {
      // 2. Scratch workspace via the raw call() escape hatch.
      const created = await client.call(
        "workspace.create",
        { label: "cc-mobile-herdr-smoke", cwd: "/tmp", focus: false },
        WorkspaceCreatedResultSchema,
      );
      workspaceId = created.workspace.workspace_id;
      const paneId = created.root_pane.pane_id;

      // 3. Subscribe to the marker BEFORE typing so the match cannot be missed.
      let resolveMatched: (event: EventEnvelope) => void = () => {};
      const matchedEvent = new Promise<EventEnvelope>((resolve) => {
        resolveMatched = resolve;
      });
      subscription = await client.subscribeEvents({
        subscriptions: [
          {
            type: "pane.output_matched",
            pane_id: paneId,
            source: "visible",
            match: { type: "substring", value: MARKER },
          },
        ],
        onEvent: (event) => {
          if (event.event === "pane.output_matched") resolveMatched(event);
        },
      });

      // 4. Type the marker command (send_text never submits), then press Enter.
      await client.paneSendText(paneId, `echo ${MARKER}`);
      await client.paneSendKeys(paneId, ["Enter"]);

      // 5. The matched event arrives within the deadline.
      const event = await withinMs(matchedEvent, EVENT_DEADLINE_MS, "pane.output_matched event");
      expect(event.event).toBe("pane.output_matched");

      // 6. The visible screen contains the marker.
      const read = await client.paneRead({ pane_id: paneId, source: "visible" });
      expect(read.text).toContain(MARKER);

      // 7. Agent methods reject with the typed miss on an agent-less shell pane.
      const agentError = await client.agentGet(paneId).then(
        () => null,
        (error: unknown) => error,
      );
      expect(agentError).toBeInstanceOf(HerdrRpcError);
      expect((agentError as HerdrRpcError).code).toBe("agent_not_found");
    } finally {
      // Cleanup always runs: stop the stream, close the scratch workspace.
      subscription?.stop();
      if (workspaceId !== undefined) {
        const closed = await client.call(
          "workspace.close",
          { workspace_id: workspaceId },
          OkResultSchema,
        );
        expect(closed.type).toBe("ok");

        // No scratch workspace left behind.
        const paneList = await client.call("pane.list", {}, PaneListResultSchema);
        expect(paneList.panes.some((pane) => pane.workspace_id === workspaceId)).toBe(false);
      }
    }
  },
  TEST_TIMEOUT_MS,
);
