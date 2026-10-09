import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const RULE = "─".repeat(60);

/** How the fake claude behaves once the prompt is typed. */
interface Claude {
  /** Status before the prompt. */
  status?: string;
  /** Enters it takes to start the turn; `Infinity` leaves the prompt in the composer. */
  startsAfterEnters?: number;
  /** What a started turn reports; `idle` is a submit whose status never caught up. */
  startStatus?: string;
  /** The screen while the prompt sits unsent: its composer, a dialog, or no read at all. */
  screen?: "composer" | "dialog" | "unreadable";
  /** Every `agent.get` after the text is typed fails. */
  statusFailsAfterTyping?: boolean;
}

/** A daemon reporting one drivable claude pane, recording what is typed into it. */
function fakeHerdr(claude: Claude = {}) {
  const { startsAfterEnters = 1, startStatus = "working", screen = "composer" } = claude;
  let enters = 0;
  let pending = false;
  const typed: string[] = [];
  /** Runs once, on the first status sample after the text is typed. */
  const hooks: { duringWait?: () => void } = {};
  const agent = {
    terminal_id: "t1",
    agent_status: claude.status ?? "idle",
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
    agentGet: async () => {
      if (typed.length > 0) {
        const hook = hooks.duringWait;
        hooks.duringWait = undefined;
        hook?.();
        if (claude.statusFailsAfterTyping) throw new Error("socket closed");
      }
      return agent;
    },
    sessionSnapshot: async () => ({
      version: "0.7.5",
      protocol: 17,
      workspaces: [{ workspace_id: "w3V", label: "ccm-3f2a9b01-1111-4222-8333-444455556666" }],
      panes: [],
      agents: [],
    }),
    paneRead: async () => {
      if (!pending) return { text: ["", RULE, " ❯ ", RULE].join("\n"), revision: 1 };
      if (screen === "unreadable") throw new Error("socket closed");
      if (screen === "dialog")
        return { text: "Do you want to proceed?\n❯ 1. Yes\n  2. No", revision: 2 };
      return {
        text: ["", RULE, `❯ ${composeLaunchPrompt(CARD).split("\n")[0]}`, "  …", RULE].join("\n"),
        revision: 2,
      };
    },
    paneSendText: async (_pane: string, text: string) => {
      typed.push(`text:${text}`);
      pending = true;
    },
    paneSendKeys: async (_pane: string, keys: string[]) => {
      typed.push(`keys:${keys.join("+")}`);
      if (keys.includes("Enter") && ++enters >= startsAfterEnters) {
        agent.agent_status = startStatus;
        pending = false;
      }
    },
    call: async (_m: string, params: unknown) => ({
      type: "pane_process_info",
      process_info: {
        pane_id: (params as { pane_id: string }).pane_id,
        foreground_processes: [{ pid: 1, argv0: "claude", argv: ["claude"] }],
      },
    }),
    subscribeEvents: async () => ({ stop() {} }),
  };
  return { client, typed, hooks };
}

function launchApp(claude?: Claude) {
  const { client, typed, hooks } = fakeHerdr(claude);
  const backend = createHerdrBackend({
    client: client as never,
    startPollMs: 1,
    startWindowMs: 20,
  }) as AppBackend;
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
      cardWorktrees: { create: async () => ({ kind: "not_a_repo" }), remove: async () => {} },
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
  return {
    post,
    typed,
    hooks,
    backend,
    eventBuffer,
    launchesDir,
    created,
    auditPath: join(dir, "a.jsonl"),
  };
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
  const { post, typed, eventBuffer, created } = launchApp({ status: "working" });
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

test("a prompt claude swallowed is sent by pressing Enter again, and the launch succeeds", async () => {
  const { post, typed } = launchApp({ startsAfterEnters: 3 });
  const r = await post();
  expect(r.status).toBe(201);
  expect(typed).toEqual([
    "text:" + composeLaunchPrompt(CARD),
    "keys:Enter",
    "keys:Enter",
    "keys:Enter",
  ]);
});

test("a prompt that never starts a turn answers 502, not 201, and keeps the binding", async () => {
  const { post, typed, eventBuffer, launchesDir, created, auditPath } = launchApp({
    startsAfterEnters: Infinity,
  });
  const r = await post();
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({
    error: "prompt_failed",
    code: "prompt_not_started",
    sessionId: PANE,
    claudeUuid: created[0],
  });
  expect(typed).toEqual([
    "text:" + composeLaunchPrompt(CARD),
    "keys:Enter",
    "keys:Enter",
    "keys:Enter",
  ]);
  expect(existsSync(join(launchesDir, `${created[0]}.json`))).toBe(true);
  expect(eventBuffer.replay(PANE, -1).map((e) => e.message.code)).toEqual(["prompt_not_started"]);
  const audit = readFileSync(auditPath, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(audit.map((a) => [a.action, a.outcome])).toEqual([["prompt_send", "failed"]]);
});

const PROMPT_THEN_ENTER = ["text:" + composeLaunchPrompt(CARD), "keys:Enter"];

test("a phone that rebinds the pane's sink mid-wait does not turn a never-started prompt into 201", async () => {
  const { post, hooks, backend } = launchApp({ startsAfterEnters: Infinity });
  const phone: Record<string, unknown>[] = [];
  hooks.duringWait = () => backend.registerClient(PANE, (msg) => phone.push(msg), {});
  const r = await post();
  expect(r.status).toBe(502);
  expect((await r.json()).code).toBe("prompt_not_started");
  expect(phone.map((m) => m.code)).toEqual(["prompt_not_started"]);
});

test("an unrelated notice on the sink during the wait does not decide the launch", async () => {
  const { post, hooks, backend } = launchApp();
  hooks.duringWait = () =>
    backend.getClient(PANE)?.({ type: "error", sessionId: PANE, code: "agent_attention_notice" });
  const r = await post();
  expect(r.status).toBe(201);
});

test("a turn that already settled to done counts as started, with no extra Enter", async () => {
  const { post, typed } = launchApp({ startStatus: "done" });
  expect((await post()).status).toBe(201);
  expect(typed).toEqual(PROMPT_THEN_ENTER);
});

test("a status that never moves is not confirmed, even when the composer has emptied", async () => {
  const { post, typed } = launchApp({ startStatus: "idle" });
  const r = await post();
  expect(r.status).toBe(502);
  expect((await r.json()).code).toBe("prompt_not_started");
  expect(typed).toEqual(PROMPT_THEN_ENTER);
});

test("no extra Enter is pressed on a screen with no composer", async () => {
  const { post, typed } = launchApp({ startsAfterEnters: Infinity, screen: "dialog" });
  const r = await post();
  expect(r.status).toBe(502);
  expect((await r.json()).code).toBe("prompt_not_started");
  expect(typed).toEqual(PROMPT_THEN_ENTER);
});

test("failed status samples and an unreadable screen press nothing more and report failure", async () => {
  const { post, typed } = launchApp({
    startsAfterEnters: Infinity,
    statusFailsAfterTyping: true,
    screen: "unreadable",
  });
  const r = await post();
  expect(r.status).toBe(502);
  expect((await r.json()).code).toBe("prompt_not_started");
  expect(typed).toEqual(PROMPT_THEN_ENTER);
});

test("failed status samples press nothing, though the prompt is still in the composer", async () => {
  const { post, typed } = launchApp({ startsAfterEnters: 2, statusFailsAfterTyping: true });
  const r = await post();
  expect(r.status).toBe(502);
  expect((await r.json()).code).toBe("prompt_not_started");
  expect(typed).toEqual(PROMPT_THEN_ENTER);
});
