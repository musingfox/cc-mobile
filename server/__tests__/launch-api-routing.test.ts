import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppBackend, createApp } from "../app";
import { EventBuffer } from "../event-buffer";
import { createHerdrBackend } from "../herdr/backend";
import { composeLaunchPrompt } from "../launch-prompt";
import { testServerConfig } from "./ws-harness";

const PANE = "w3V:p1";
const CARD = "# Task\nCARD-BODY do the thing\n";
const CARD_PATH = "pm/cc-mobile/tasks/card.md";

/** A daemon reporting one idle, drivable claude pane, recording what is typed into it. */
function fakeHerdr(status = "idle") {
  const typed: string[] = [];
  const agent = {
    terminal_id: "t1",
    agent_status: status,
    workspace_id: "w3V",
    tab_id: "w3V:t1",
    pane_id: PANE,
    focused: false,
    revision: 4,
    agent: "claude",
    cwd: "/tmp",
    agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "sess-1" },
  };
  const client = {
    agentList: async () => [agent],
    agentGet: async () => agent,
    sessionSnapshot: async () => ({
      version: "0.7.5",
      protocol: 17,
      workspaces: [{ workspace_id: "w3V", label: "ccm-3f2a9b01-1111-4222-8333-444455556666" }],
      panes: [],
      agents: [],
    }),
    paneRead: async () => ({ text: "", revision: 1 }),
    paneSendText: async (_pane: string, text: string) => void typed.push(`text:${text}`),
    paneSendKeys: async (_pane: string, keys: string[]) =>
      void typed.push(`keys:${keys.join("+")}`),
    call: async (_m: string, params: unknown) => ({
      type: "pane_process_info",
      process_info: {
        pane_id: (params as { pane_id: string }).pane_id,
        foreground_processes: [{ pid: 1, argv0: "claude", argv: ["claude"] }],
      },
    }),
    subscribeEvents: async () => ({ stop() {} }),
  };
  return { client, typed };
}

function launchApp(status?: string) {
  const { client, typed } = fakeHerdr(status);
  const backend = createHerdrBackend({ client: client as never }) as AppBackend;
  // Only the workspace creation is stood in for; send-routing below is the real one.
  const created: string[] = [];
  backend.createSession = async (input) => {
    created.push(input.claudeUuid);
    return { name: "claude", paneRef: PANE };
  };
  const eventBuffer = new EventBuffer(500);
  const dir = mkdtempSync(join(tmpdir(), "launch-audit-"));
  const vault = join(dir, "obsidian");
  mkdirSync(join(vault, "pm", "cc-mobile", "tasks"), { recursive: true });
  writeFileSync(join(vault, CARD_PATH), CARD);
  const launchesDir = join(dir, "launches");
  const app = createApp(
    { ...testServerConfig, launchToken: "tok", hangarSession: "fleet", vaultRoot: vault },
    {
      backend,
      eventBuffer,
      gateEnv: {},
      auditLogPath: join(dir, "a.jsonl"),
      launchesDir,
    },
  );
  const post = () =>
    app.handle(
      new Request("http://localhost/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer tok" },
        body: JSON.stringify({
          cwd: "/tmp",
          cardPath: CARD_PATH,
          vault: "obsidian",
          project: "cc-mobile",
        }),
      }),
    );
  return { post, typed, eventBuffer, launchesDir, created };
}

test("an HTTP launch with no WebSocket client types the template and card, presses Enter, and binds the session", async () => {
  const { post, typed, launchesDir } = launchApp();
  const r = await post();
  expect(r.status).toBe(201);
  const { claudeUuid } = await r.json();
  expect(typed).toEqual(["text:" + composeLaunchPrompt(CARD), "keys:Enter"]);
  expect(existsSync(join(launchesDir, `${claudeUuid}.json`))).toBe(true);
});

test("a busy pane answers 502 with the routing's code, and nothing is typed", async () => {
  const { post, typed, eventBuffer, created } = launchApp("working");
  const r = await post();
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({
    error: "prompt_failed",
    code: "session_busy",
    sessionId: PANE,
    claudeUuid: created[0],
  });
  expect(typed).toEqual([]);
  expect(eventBuffer.replay(PANE, -1).map((e) => e.message.code)).toEqual(["session_busy"]);
});
