/**
 * agent-notice.test.ts — AnnounceOnceLedger + BlockedScreenNoticeDelivery.
 *
 * The same screen is announced once per session. After the caller declares the
 * episode over, that screen may be announced again. Ledgers are per session.
 * A blocked non-prompt screen's own words go out as an error frame, once.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createAgentNotice } from "./agent-notice";

const FIXTURES = join(import.meta.dir, "../permission/fixtures");
const OMP_API_FAILURE = readFileSync(join(FIXTURES, "omp-api-failure.txt"), "utf8");

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
    const n = ledger();
    expect(() => n.clear("nobody")).not.toThrow();
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
