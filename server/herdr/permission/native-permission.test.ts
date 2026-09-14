/**
 * NativePermissionRequestEmit + PermissionAnswerKeySend — a blocked pane raises
 * the prompt on the phone, and a tap presses that key in the terminal, but only
 * while the prompt on screen is still the one the user was shown.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createNativePermission,
  type NativePermissionClient,
  UNATTENDED_DENY_MS,
} from "./native-permission";

const FIXTURES = join(import.meta.dir, "fixtures");
const BASH_PROMPT = readFileSync(join(FIXTURES, "blocked-bash-prompt.txt"), "utf8");
const OTHER_PROMPT = BASH_PROMPT.replaceAll("canary2.txt", "somethingelse.txt");
const UNPARSEABLE = "❯ waiting\n\n  the screen says nothing we understand\n";

const OMP_API_FAILURE = readFileSync(join(FIXTURES, "omp-api-failure.txt"), "utf8");
const OMP_ALLOW_TOOL = readFileSync(join(FIXTURES, "omp-allow-tool-prompt.txt"), "utf8");
/** The same prompt as omp 17.4.1 draws it: inside a box. Live capture 2026-08-25. */
const OMP_BORDERED = readFileSync(join(FIXTURES, "omp-bordered-prompt.txt"), "utf8");
const OMP_NO_API_KEY = readFileSync(join(FIXTURES, "omp-no-api-key.txt"), "utf8");

/** claude's AskUserQuestion screen: a question, not a permission gate. */
const QUESTION = readFileSync(join(FIXTURES, "claude-ask-user-question.txt"), "utf8");
/** The variant whose answer is a sequence, so it parses as nothing at all. */
const MULTISELECT = readFileSync(join(FIXTURES, "claude-ask-multiselect.txt"), "utf8");

const PANE = "w3V:p1";

interface Harness {
  permission: ReturnType<typeof createNativePermission>;
  sent: Record<string, unknown>[];
  keys: { pane: string; keys: string[] }[];
  screen: { text: string; revision: number };
  status: { value: string };
  client: NativePermissionClient;
}

function makeFakeClock(startMs = 1_000_000) {
  let current = startMs;
  type Timer = { id: number; fireAt: number; fn: () => void; cleared: boolean };
  const timers: Timer[] = [];
  let nextId = 1;

  return {
    now: () => current,
    setTimeoutFn: (fn: () => void, ms: number) => {
      const timer: Timer = { id: nextId++, fireAt: current + ms, fn, cleared: false };
      timers.push(timer);
      return timer.id;
    },
    clearTimeoutFn: (id: unknown) => {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cleared = true;
    },
    async advance(ms: number) {
      current += ms;
      for (const timer of [...timers]) {
        if (timer.cleared || timer.fireAt > current) continue;
        timer.cleared = true;
        timer.fn();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function harness(
  overrides: Partial<{
    origin: "self" | "foreign";
    paneRead: NativePermissionClient["paneRead"];
    agentGet: NativePermissionClient["agentGet"];
    sink: boolean;
    onUnparsedBlockedScreen: (sessionId: string, screen: string) => void;
    warn: (message: string) => void;
    clock: ReturnType<typeof makeFakeClock>;
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
    warn: overrides.warn ?? (() => {}),
    onUnparsedBlockedScreen: overrides.onUnparsedBlockedScreen,
    ...(overrides.clock
      ? {
          setTimeoutFn: overrides.clock.setTimeoutFn,
          clearTimeoutFn: overrides.clock.clearTimeoutFn,
          now: overrides.clock.now,
        }
      : {}),
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

/**
 * The same flow on an omp pane. What differs is the answer: omp's options carry
 * no key of their own, so the keystrokes are a distance measured against the
 * screen at answer time, not at emit time.
 */
describe("PermissionAnswerKeySend — omp", () => {
  // U+F054, the Nerd Font chevron omp draws in front of the selected row.
  // Written as an escape: the glyph itself is invisible in most editors and
  // does not survive every way a file gets written.
  const CURSOR = "\uF054";

  function ompScreen(selected: 0 | 1): string {
    return [
      "──────────────────────────────────────────────────────",
      "",
      " Allow tool: bash",
      " Command: echo hello",
      "",
      selected === 0 ? ` ${CURSOR} Approve` : "   Approve",
      selected === 1 ? ` ${CURSOR} Deny` : "   Deny",
      "",
      " up/down navigate  enter select  esc cancel",
      "",
      "──────────────────────────────────────────────────────",
    ].join("\n");
  }

  test("an omp prompt reaches the phone with the terminal's own two options", async () => {
    const h = harness();
    h.screen.text = ompScreen(0);

    await h.permission.onStatus(PANE, "blocked");

    const request = h.sent.find((msg) => msg.type === "permission_request");
    expect(request?.tool).toEqual({ name: "bash", parameters: { text: "Command: echo hello" } });
    expect(request?.options).toEqual([
      { id: "0", label: "Approve" },
      { id: "1", label: "Deny" },
    ]);
  });

  test("choosing Deny travels down from the cursor and presses Enter", async () => {
    const h = harness();
    h.screen.text = ompScreen(0);
    await h.permission.onStatus(PANE, "blocked");

    await h.permission.resolve("r1", { optionId: "1" });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["Down", "Enter"] }]);
  });

  test("the distance is measured when the answer lands, not when it was shown", async () => {
    const h = harness();
    h.screen.text = ompScreen(0);
    await h.permission.onStatus(PANE, "blocked");
    // A human at the terminal moved the selection while the phone was deciding.
    // Same question, so the answer still goes — but from where the cursor IS.
    h.screen.text = ompScreen(1);

    await h.permission.resolve("r1", { optionId: "0" });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["Up", "Enter"] }]);
  });

  test("the legacy allow form takes omp's first option, not a digit", async () => {
    const h = harness();
    h.screen.text = ompScreen(1);
    await h.permission.onStatus(PANE, "blocked");

    await h.permission.resolve("r1", { allow: true });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["Up", "Enter"] }]);
  });

  test("the legacy deny form still presses esc, which is what omp labels it", async () => {
    const h = harness();
    h.screen.text = ompScreen(0);
    await h.permission.onStatus(PANE, "blocked");

    await h.permission.resolve("r1", { allow: false });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });

  test("an option this prompt does not offer sends nothing", async () => {
    const h = harness();
    h.screen.text = ompScreen(0);
    await h.permission.onStatus(PANE, "blocked");

    await h.permission.resolve("r1", { optionId: "7" });

    expect(h.keys).toEqual([]);
    expect(h.sent.some((msg) => msg.code === "permission_option_unknown")).toBe(true);
  });
});

describe("SuppressUnanswerablePermissionCard", () => {
  test("T1: omp blocked with an API-failure screen raises no permission card", async () => {
    const h = harness();
    h.screen.text = OMP_API_FAILURE;

    await h.permission.onStatus(PANE, "blocked", "omp");

    expect(h.sent.filter((msg) => msg.type === "permission_request")).toHaveLength(0);
    expect(h.permission.pendingCount()).toBe(0);
  });

  test("T2: claude blocked on an unparseable screen still raises Cancel-only", async () => {
    const h = harness();
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked", "claude");

    const requests = h.sent.filter((msg) => msg.type === "permission_request");
    expect(requests).toHaveLength(1);
    const request = requests[0] as {
      tool: { name: string };
      options: { id: string; label: string; keystroke: string }[];
    };
    expect(request.tool.name).toBe("Permission required");
    expect(request.options).toEqual([{ id: "cancel", label: "Cancel", keystroke: "esc" }]);
  });

  test("T3: omp Allow-tool bash still raises a real permission card", async () => {
    const h = harness();
    h.screen.text = OMP_ALLOW_TOOL;

    await h.permission.onStatus(PANE, "blocked", "omp");

    const requests = h.sent.filter((msg) => msg.type === "permission_request");
    expect(requests).toHaveLength(1);
    expect((requests[0] as { tool: { name: string } }).tool.name).toBe("bash");
  });

  test("T3b: the boxed omp prompt raises the same card as the flat one", async () => {
    // The regression that motivated this test cost nothing at this layer: omp
    // 17.4.1 boxed the prompt, every parse anchor missed, and the pane simply
    // sat blocked while the phone was never asked. Nothing threw, and the
    // suite above stayed green against its 17.2.9 fixture. Pinning both shapes
    // here is what makes the next re-draw fail in `bun test` rather than in
    // production.
    const h = harness();
    h.screen.text = OMP_BORDERED;

    await h.permission.onStatus(PANE, "blocked", "omp");

    const requests = h.sent.filter((msg) => msg.type === "permission_request");
    expect(requests).toHaveLength(1);
    const request = requests[0] as {
      tool: { name: string };
      options: { id: string; label: string }[];
    };
    expect(request.tool.name).toBe("bash");
    expect(request.options.map((option) => option.label)).toEqual(["Approve", "Deny"]);
  });

  test("T4: claude bash prompt still raises Bash command with 3 options", async () => {
    const h = harness();
    h.screen.text = BASH_PROMPT;

    await h.permission.onStatus(PANE, "blocked", "claude");

    const requests = h.sent.filter((msg) => msg.type === "permission_request");
    expect(requests).toHaveLength(1);
    const request = requests[0] as {
      tool: { name: string };
      options: unknown[];
    };
    expect(request.tool.name).toBe("Bash command");
    expect(request.options).toHaveLength(3);
  });

  test("T5: kind-absent unparseable screen raises Cancel-only", async () => {
    const h = harness();
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked");

    const requests = h.sent.filter((msg) => msg.type === "permission_request");
    expect(requests).toHaveLength(1);
    const request = requests[0] as {
      tool: { name: string };
      options: unknown[];
    };
    expect(request.tool.name).toBe("Permission required");
    expect(request.options).toEqual([{ id: "cancel", label: "Cancel", keystroke: "esc" }]);
  });

  test("T6: omp unparseable self pane does not unattended-esc after 90s", async () => {
    const clock = makeFakeClock();
    const h = harness({ origin: "self", clock });
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked", "omp");
    await clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toHaveLength(0);
  });

  test("T8: claude unparseable self pane still unattended-esc after 90s", async () => {
    const clock = makeFakeClock();
    const h = harness({ origin: "self", clock });
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked", "claude");
    await clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });
});

describe("UnparsedBlockedScreenHandoff", () => {
  test("T1: omp unparseable screen is handed to the collaborator untrimmed", async () => {
    const handed: Array<[string, string]> = [];
    const h = harness({
      onUnparsedBlockedScreen: (sessionId, screen) => {
        handed.push([sessionId, screen]);
      },
    });
    h.screen.text = OMP_NO_API_KEY;

    await h.permission.onStatus(PANE, "blocked", "omp");

    expect(handed).toEqual([[PANE, OMP_NO_API_KEY]]);
    expect(handed[0][1]).toBe("Error: No API key found for anthropic.\n");
  });

  test("T2: omp Allow-tool prompt does not hand off", async () => {
    const handed: Array<[string, string]> = [];
    const h = harness({
      onUnparsedBlockedScreen: (sessionId, screen) => {
        handed.push([sessionId, screen]);
      },
    });
    h.screen.text = OMP_ALLOW_TOOL;

    await h.permission.onStatus(PANE, "blocked", "omp");

    expect(handed).toHaveLength(0);
  });

  test("T3: kind-absent unparseable screen does not hand off", async () => {
    const handed: Array<[string, string]> = [];
    const h = harness({
      onUnparsedBlockedScreen: (sessionId, screen) => {
        handed.push([sessionId, screen]);
      },
    });
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked");

    expect(handed).toHaveLength(0);
  });

  test("T3b: claude unparseable screen does not hand off", async () => {
    const handed: Array<[string, string]> = [];
    const h = harness({
      onUnparsedBlockedScreen: (sessionId, screen) => {
        handed.push([sessionId, screen]);
      },
    });
    h.screen.text = UNPARSEABLE;

    await h.permission.onStatus(PANE, "blocked", "claude");

    expect(handed).toHaveLength(0);
  });

  test("T4: a throwing collaborator does not reject onStatus and is warned", async () => {
    const warnings: string[] = [];
    const h = harness({
      warn: (message) => warnings.push(message),
      onUnparsedBlockedScreen: () => {
        throw new Error("boom");
      },
    });
    h.screen.text = OMP_NO_API_KEY;

    await expect(h.permission.onStatus(PANE, "blocked", "omp")).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("boom");
  });
});

/**
 * The 90-second unattended deny answers a question nobody asked the user: `esc`
 * at an AskUserQuestion screen cancels the question itself. So a parsed question
 * waits, and everything else on the same pane still decays exactly as before.
 */
describe("QuestionExemptFromAutoDeny", () => {
  test("T1: an unanswered question on a self pane is still pending after 90s", async () => {
    const clock = makeFakeClock();
    const h = harness({ origin: "self", clock });
    h.screen.text = QUESTION;

    await h.permission.onStatus(PANE, "blocked", "claude");
    await clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([]);
    expect(h.permission.pendingFor(PANE)).toBeDefined();
  });

  test("T2: a permission prompt on a self pane still auto-denies after 90s", async () => {
    const clock = makeFakeClock();
    const h = harness({ origin: "self", clock });

    await h.permission.onStatus(PANE, "blocked", "claude");
    await clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });

  test("T3: a multi-select screen nobody parsed keeps its countdown", async () => {
    const clock = makeFakeClock();
    const h = harness({ origin: "self", clock });
    h.screen.text = MULTISELECT;

    await h.permission.onStatus(PANE, "blocked", "claude");
    await clock.advance(UNATTENDED_DENY_MS);

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });
});

/**
 * The answer to a question is the digit it prints, pressed in the pane — the
 * same send path a permission answer takes, guarded the same way. The guard
 * matters more here: the human at the terminal may have answered and been asked
 * the next question already.
 */
describe("QuestionAnswerKeySend", () => {
  /** The next question, drawn where the first one was. */
  const OTHER_QUESTION = QUESTION.replaceAll("A 或 B", "C 或 D");

  let h: Harness;

  beforeEach(async () => {
    h = harness();
    h.screen.text = QUESTION;
    await h.permission.onStatus(PANE, "blocked", "claude");
    h.sent.length = 0;
  });

  test("T1: choosing the second answer presses that digit and clears the prompt", async () => {
    const handled = await h.permission.resolve("r1", { optionId: "2" });

    expect(handled).toBe(true);
    expect(h.keys).toEqual([{ pane: PANE, keys: ["2"] }]);
    expect(h.permission.pendingFor(PANE)).toBeUndefined();
  });

  test("T2: an answer arriving after the terminal moved on sends nothing", async () => {
    h.screen.text = OTHER_QUESTION;

    await h.permission.resolve("r1", { optionId: "1" });

    expect(h.keys).toEqual([]);
    expect((h.sent[0] as { code: string }).code).toBe("permission_prompt_stale");
  });
});

/**
 * A bundle cached before questions existed answers with `{allow}`. On a
 * permission prompt that still means what it meant; on a question there is no
 * option that means "yes", so the migration window closes rather than picking
 * the first answer on the user's behalf.
 */
describe("LegacyAllowRefusedOnQuestion", () => {
  test("T1: the legacy allow form answers nothing on a question", async () => {
    const h = harness();
    h.screen.text = QUESTION;
    await h.permission.onStatus(PANE, "blocked", "claude");
    h.sent.length = 0;

    await h.permission.resolve("r1", { allow: true });

    expect(h.keys).toEqual([]);
    expect((h.sent[0] as { code: string }).code).toBe("permission_option_unknown");
  });

  test("T2: the legacy deny form still presses esc on a question", async () => {
    const h = harness();
    h.screen.text = QUESTION;
    await h.permission.onStatus(PANE, "blocked", "claude");

    await h.permission.resolve("r1", { allow: false });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["esc"] }]);
  });

  test("T3: the legacy allow form still takes the first option on a permission prompt", async () => {
    const h = harness();
    await h.permission.onStatus(PANE, "blocked", "claude");

    await h.permission.resolve("r1", { allow: true });

    expect(h.keys).toEqual([{ pane: PANE, keys: ["1"] }]);
  });
});
