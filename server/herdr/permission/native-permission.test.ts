/**
 * NativePermissionRequestEmit + PermissionAnswerKeySend — a blocked pane raises
 * the prompt on the phone, and a tap presses that key in the terminal, but only
 * while the prompt on screen is still the one the user was shown.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNativePermission, type NativePermissionClient } from "./native-permission";

const FIXTURES = join(import.meta.dir, "fixtures");
const BASH_PROMPT = readFileSync(join(FIXTURES, "blocked-bash-prompt.txt"), "utf8");
const OTHER_PROMPT = BASH_PROMPT.replaceAll("canary2.txt", "somethingelse.txt");
const UNPARSEABLE = "❯ waiting\n\n  the screen says nothing we understand\n";

const PANE = "w3V:p1";

interface Harness {
  permission: ReturnType<typeof createNativePermission>;
  sent: Record<string, unknown>[];
  keys: { pane: string; keys: string[] }[];
  screen: { text: string; revision: number };
  status: { value: string };
  client: NativePermissionClient;
}

function harness(
  overrides: Partial<{
    origin: "self" | "foreign";
    paneRead: NativePermissionClient["paneRead"];
    agentGet: NativePermissionClient["agentGet"];
    sink: boolean;
  }> = {},
): Harness {
  const sent: Record<string, unknown>[] = [];
  const keys: { pane: string; keys: string[] }[] = [];
  const screen = { text: BASH_PROMPT, revision: 7 };
  const status = { value: "blocked" };

  const client: NativePermissionClient = {
    agentGet: overrides.agentGet ?? (async () => ({ agent_status: status.value })),
    paneRead:
      overrides.paneRead ?? (async () => ({ text: screen.text, revision: screen.revision })),
    paneSendKeys: async (pane, pressed) => {
      keys.push({ pane, keys: pressed });
    },
  };

  let counter = 0;
  const permission = createNativePermission({
    client,
    getSink: overrides.sink === false ? () => undefined : () => (msg) => sent.push(msg),
    originOf: () => overrides.origin ?? "foreign",
    newRequestId: () => `r${++counter}`,
    warn: () => {},
  });

  return { permission, sent, keys, screen, status, client };
}

describe("NativePermissionRequestEmit", () => {
  test("a blocked pane raises one request carrying the terminal's own options", async () => {
    const h = harness();

    await h.permission.onStatus(PANE, "blocked");

    expect(h.sent).toHaveLength(1);
    const request = h.sent[0] as {
      type: string;
      sessionId: string;
      requestId: string;
      tool: { name: string; parameters: Record<string, unknown> };
      options: { id: string; label: string; keystroke: string }[];
    };
    expect(request.type).toBe("permission_request");
    expect(request.sessionId).toBe(PANE);
    expect(request.tool.name).toBe("Bash command");
    expect(request.tool.parameters.text).toBe(
      "touch /private/tmp/cf-0802-JmBO/probe/cwd/canary2.txt",
    );
    expect(request.tool.parameters.description).toBe("Create empty canary2.txt file");
    expect(request.options).toHaveLength(3);
    expect(request.options[2]).toEqual({ id: "3", label: "No", keystroke: "3" });
  });

  test("two blocked observations of the same prompt raise exactly one request", async () => {
    const h = harness();

    await h.permission.onStatus(PANE, "blocked");
    await h.permission.onStatus(PANE, "blocked");

    expect(h.sent).toHaveLength(1);
  });

  test("a different prompt on the same pane supersedes with a new requestId", async () => {
    const h = harness();

    await h.permission.onStatus(PANE, "blocked");
    h.screen.text = OTHER_PROMPT;
    await h.permission.onStatus(PANE, "blocked");

    expect(h.sent).toHaveLength(2);
    expect((h.sent[0] as { requestId: string }).requestId).not.toBe(
      (h.sent[1] as { requestId: string }).requestId,
    );
  });

  test("an unparseable screen still raises a request, with a single Cancel action", async () => {
    const h = harness();
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked");

    const request = h.sent[0] as {
      tool: { name: string; parameters: { text: string } };
      options: unknown[];
    };
    expect(request.tool.name).toBe("Permission required");
    expect(request.tool.parameters.text).toContain("the screen says nothing we understand");
    expect(request.options).toEqual([{ id: "cancel", label: "Cancel", keystroke: "esc" }]);
  });

  test("a failing pane.read emits nothing and does not throw", async () => {
    const h = harness({
      paneRead: async () => {
        throw new Error("pane gone");
      },
    });

    await h.permission.onStatus(PANE, "blocked");

    expect(h.sent).toHaveLength(0);
    expect(h.permission.pendingCount()).toBe(0);
  });

  test("leaving blocked drops the pending record without any keystroke", async () => {
    const h = harness();

    await h.permission.onStatus(PANE, "blocked");
    await h.permission.onStatus(PANE, "working");

    expect(h.permission.pendingCount()).toBe(0);
    expect(h.keys).toHaveLength(0);
  });
});

describe("PermissionAnswerKeySend", () => {
  let h: Harness;

  beforeEach(async () => {
    h = harness();
    await h.permission.onStatus(PANE, "blocked");
    h.sent.length = 0;
  });

  test("choosing option 3 presses exactly the key 3 in that pane", async () => {
    const handled = await h.permission.resolve("r1", { optionId: "3" });

    expect(handled).toBe(true);
    expect(h.keys).toEqual([{ pane: PANE, keys: ["3"] }]);
    expect(h.permission.pendingCount()).toBe(0);
  });

  test("the legacy deny form presses esc", async () => {
    await h.permission.resolve("r1", { allow: false });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });

  test("the legacy allow form presses the terminal's first option", async () => {
    await h.permission.resolve("r1", { allow: true });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["1"] }]);
  });

  test("a pane that left blocked sends nothing and reports the prompt stale", async () => {
    h.status.value = "idle";

    await h.permission.resolve("r1", { optionId: "3" });

    expect(h.keys).toHaveLength(0);
    expect(h.sent).toEqual([
      {
        type: "error",
        code: "permission_prompt_stale",
        message: expect.stringContaining("changed"),
        sessionId: PANE,
      },
    ]);
  });

  test("a pane still blocked on a DIFFERENT prompt sends nothing", async () => {
    // The human at the terminal answered and claude raised the next question:
    // the status guard alone would happily press "3" at a prompt nobody saw.
    h.screen.text = OTHER_PROMPT;

    await h.permission.resolve("r1", { optionId: "3" });

    expect(h.keys).toHaveLength(0);
    expect((h.sent[0] as { code: string }).code).toBe("permission_prompt_stale");
  });

  test("an option the prompt does not offer sends nothing and says so", async () => {
    await h.permission.resolve("r1", { optionId: "9" });

    expect(h.keys).toHaveLength(0);
    expect((h.sent[0] as { code: string }).code).toBe("permission_option_unknown");
  });

  test("an unknown requestId is left alone entirely — no keys, no error frame", async () => {
    const handled = await h.permission.resolve("not-mine", { optionId: "1" });

    expect(handled).toBe(false);
    expect(h.keys).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  test("a failing send_keys reports the failure instead of claiming success", async () => {
    h.client.paneSendKeys = mock(async () => {
      throw new Error("pane closed");
    });

    await h.permission.resolve("r1", { optionId: "1" });

    expect((h.sent[0] as { code: string }).code).toBe("permission_answer_failed");
  });
});

describe("native permission across a disconnect", () => {
  test("a reconnect re-emits the live prompt as a fresh request, not a replay", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");
    const first = (h.sent[0] as { requestId: string }).requestId;

    h.permission.pause();
    await h.permission.resume();

    expect(h.sent).toHaveLength(2);
    const second = h.sent[1] as { requestId: string; type: string };
    expect(second.type).toBe("permission_request");
    expect(second.requestId).not.toBe(first);
    // The stale id no longer answers anything.
    expect(await h.permission.resolve(first, { optionId: "1" })).toBe(false);
    expect(await h.permission.resolve(second.requestId, { optionId: "1" })).toBe(true);
  });

  test("a prompt answered in the terminal during the gap is dropped, not re-shown", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked");

    h.permission.pause();
    h.status.value = "idle";
    await h.permission.resume();

    expect(h.sent).toHaveLength(1);
    expect(h.permission.pendingCount()).toBe(0);
  });
});
