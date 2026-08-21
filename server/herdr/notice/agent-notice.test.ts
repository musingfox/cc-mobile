/**
 * agent-notice.test.ts — AnnounceOnceLedger + BlockedScreenNoticeDelivery
 * + ClaudeIdleAttentionNoticeDelivery and the D3a negative contracts.
 *
 * The same screen is announced once per session. After the caller declares the
 * episode over, that screen may be announced again. Ledgers are per session.
 * A blocked non-prompt screen's own words go out as an error frame, once.
 * An idle claude trust dialog is announced as attention, never as a keystroke.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentNotice, type AgentNoticeOptions } from "./agent-notice";

const FIXTURES = join(import.meta.dir, "../permission/fixtures");
const OMP_API_FAILURE = readFileSync(join(FIXTURES, "omp-api-failure.txt"), "utf8");
const TRUST_DIALOG = readFileSync(join(FIXTURES, "trust-dialog.txt"), "utf8");
const IDLE_COMPOSER = readFileSync(join(FIXTURES, "claude-idle-composer.txt"), "utf8");
const BASH_PROMPT = readFileSync(join(FIXTURES, "blocked-bash-prompt.txt"), "utf8");

function ledger() {
  return createAgentNotice({ getSink: () => undefined });
}

describe("AnnounceOnceLedger", () => {
  test('T1: shouldAnnounce("p1","A") then shouldAnnounce("p1","A") is true then false', () => {
    const n = ledger();
    expect(n.shouldAnnounce("p1", "A")).toBe(true);
    expect(n.shouldAnnounce("p1", "A")).toBe(false);
  });

  test('T2: shouldAnnounce("p1","A") then shouldAnnounce("p1","B") is true then true', () => {
    const n = ledger();
    expect(n.shouldAnnounce("p1", "A")).toBe(true);
    expect(n.shouldAnnounce("p1", "B")).toBe(true);
  });

  test('T3: shouldAnnounce("p1","A"), clear("p1"), shouldAnnounce("p1","A") is true then true', () => {
    const n = ledger();
    expect(n.shouldAnnounce("p1", "A")).toBe(true);
    n.clear("p1");
    expect(n.shouldAnnounce("p1", "A")).toBe(true);
  });

  test('T4: shouldAnnounce("p1","A") then shouldAnnounce("p2","A") is true then true', () => {
    const n = ledger();
    expect(n.shouldAnnounce("p1", "A")).toBe(true);
    expect(n.shouldAnnounce("p2", "A")).toBe(true);
  });

  test('T5: clear("nobody") does not throw', () => {
    expect(() => ledger().clear("nobody")).not.toThrow();
  });
});

describe("BlockedScreenNoticeDelivery", () => {
  function harness() {
    const sink: Record<string, unknown>[] = [];
    const notice = createAgentNotice({
      getSink: () => (msg) => sink.push(msg),
    });
    return { notice, sink };
  }

  function expectNoPermissionRequest(sink: Record<string, unknown>[]) {
    expect(sink.filter((msg) => msg.type === "permission_request")).toEqual([]);
  }

  test("T1: no-api-key screen is one fenced error frame on that session", () => {
    const { notice, sink } = harness();
    notice.announceBlockedScreen("w3V:p1", "Error: No API key found for anthropic.\n");
    expect(sink).toEqual([
      {
        type: "error",
        code: "agent_blocked_notice",
        sessionId: "w3V:p1",
        message: "\n```\nError: No API key found for anthropic.\n```",
      },
    ]);
    expectNoPermissionRequest(sink);
  });

  test("T2: xai 429 fixture yields one frame mentioning 429 and retries exhausted", () => {
    const { notice, sink } = harness();
    notice.announceBlockedScreen("w3V:p1", OMP_API_FAILURE);
    expect(sink).toHaveLength(1);
    const message = String(sink[0]?.message ?? "");
    expect(message).toContain("429");
    expect(message.toLowerCase()).toContain("retries exhausted");
    expect(sink[0]?.type).toBe("error");
    expect(sink[0]?.code).toBe("agent_blocked_notice");
    expectNoPermissionRequest(sink);
  });

  test("T3: empty screen sends 0 frames", () => {
    const { notice, sink } = harness();
    notice.announceBlockedScreen("w3V:p1", "");
    expect(sink).toEqual([]);
    expectNoPermissionRequest(sink);
  });

  test("T4: the same screen twice is exactly 1 frame", () => {
    const { notice, sink } = harness();
    const X = "Error: No API key found for anthropic.\n";
    notice.announceBlockedScreen("w3V:p1", X);
    notice.announceBlockedScreen("w3V:p1", X);
    expect(sink).toHaveLength(1);
    expectNoPermissionRequest(sink);
  });

  test("T5: forgetEpisode lets an identical later episode speak again", () => {
    const { notice, sink } = harness();
    const X = "Error: No API key found for anthropic.\n";
    notice.announceBlockedScreen("p1", X);
    notice.forgetEpisode("p1");
    notice.announceBlockedScreen("p1", X);
    expect(sink).toHaveLength(2);
    expectNoPermissionRequest(sink);
  });

  test("T6: missing sink does not throw and sends 0 frames", () => {
    const sink: Record<string, unknown>[] = [];
    const notice = createAgentNotice({ getSink: () => undefined });
    expect(() => notice.announceBlockedScreen("unknown-pane", "text")).not.toThrow();
    expect(sink).toEqual([]);
    expectNoPermissionRequest(sink);
  });
});

type PaneReadFn = (params: {
  pane_id: string;
  source: "detection";
}) => Promise<{ text: string; revision: number }>;

function idleHarness(input: {
  screen?: string;
  paneRead?: "missing" | "throw" | "reject" | PaneReadFn;
} = {}) {
  const sink: Record<string, unknown>[] = [];
  const reads: unknown[] = [];
  const keys: { pane: string; keys: string[] }[] = [];
  const warnings: string[] = [];
  const screen = input.screen ?? TRUST_DIALOG;

  let paneRead: PaneReadFn | undefined = async (params) => {
    reads.push(params);
    return { text: screen, revision: 1 };
  };

  if (input.paneRead === "missing") {
    paneRead = undefined;
  } else if (input.paneRead === "throw") {
    paneRead = () => {
      reads.push("throw");
      throw new Error("sync paneRead boom");
    };
  } else if (input.paneRead === "reject") {
    paneRead = async (params) => {
      reads.push(params);
      throw new Error("pane.read rejected");
    };
  } else if (typeof input.paneRead === "function") {
    paneRead = input.paneRead;
  }

  const client = {
    ...(paneRead ? { paneRead } : {}),
    paneSendKeys: async (paneId: string, sent: string[]) => {
      keys.push({ pane: paneId, keys: sent });
    },
  };

  const notice = createAgentNotice({
    getSink: () => (msg) => sink.push(msg),
    client: client as AgentNoticeOptions["client"],
    warn: (message) => warnings.push(message),
  });

  return { notice, sink, reads, keys, warnings };
}

function attentionFrames(sink: Record<string, unknown>[]) {
  return sink.filter((msg) => msg.code === "agent_attention_notice");
}

describe("ClaudeIdleAttentionNoticeDelivery", () => {
  test("T1: idle claude trust dialog is one attention error containing Quick safety check", async () => {
    const h = idleHarness({ screen: TRUST_DIALOG });
    await h.notice.onStatus("w3V:p1", "idle", "claude");
    expect(attentionFrames(h.sink)).toHaveLength(1);
    expect(h.sink[0]).toMatchObject({
      type: "error",
      code: "agent_attention_notice",
      sessionId: "w3V:p1",
    });
    expect(String(h.sink[0]?.message)).toContain("Quick safety check");
  });

  test("T2: idle with kind not yet detected still announces the dialog", async () => {
    const h = idleHarness({ screen: TRUST_DIALOG });
    await h.notice.onStatus("w3V:p1", "idle");
    expect(attentionFrames(h.sink)).toHaveLength(1);
  });

  test("T3: idle omp never reads the pane", async () => {
    const h = idleHarness({ screen: TRUST_DIALOG });
    await h.notice.onStatus("w3V:p1", "idle", "omp");
    expect(h.reads).toHaveLength(0);
    expect(h.sink).toEqual([]);
  });

  test("T4: ordinary idle claude Empty state reads once and sends nothing", async () => {
    const h = idleHarness({ screen: IDLE_COMPOSER });
    await h.notice.onStatus("w3V:p1", "idle", "claude");
    expect(h.reads).toHaveLength(1);
    expect(h.sink).toEqual([]);
  });

  test("T5: working claude never reads", async () => {
    const h = idleHarness({ screen: TRUST_DIALOG });
    await h.notice.onStatus("w3V:p1", "working", "claude");
    expect(h.reads).toHaveLength(0);
    expect(h.sink).toEqual([]);
  });

  test("T6: idle ledger is not cleared by a status change", async () => {
    const h = idleHarness({ screen: TRUST_DIALOG });
    await h.notice.onStatus("p1", "idle", "claude");
    await h.notice.onStatus("p1", "working", "claude");
    await h.notice.onStatus("p1", "idle", "claude");
    expect(attentionFrames(h.sink)).toHaveLength(1);
  });

  test("T7: rejecting paneRead resolves, sends nothing, warns once", async () => {
    const h = idleHarness({ paneRead: "reject" });
    await expect(h.notice.onStatus("p1", "idle", "claude")).resolves.toBeUndefined();
    expect(h.sink).toEqual([]);
    expect(h.warnings).toHaveLength(1);
  });

  test("T8: missing or throwing paneRead resolves, sends nothing, warns once", async () => {
    const missing = idleHarness({ paneRead: "missing" });
    await expect(missing.notice.onStatus("p1", "idle", "claude")).resolves.toBeUndefined();
    expect(missing.sink).toEqual([]);
    expect(missing.warnings).toHaveLength(1);
    expect(missing.keys).toEqual([]);

    const thrown = idleHarness({ paneRead: "throw" });
    await expect(thrown.notice.onStatus("p1", "idle", "claude")).resolves.toBeUndefined();
    expect(thrown.sink).toEqual([]);
    expect(thrown.warnings).toHaveLength(1);
    expect(thrown.keys).toEqual([]);
  });
});
