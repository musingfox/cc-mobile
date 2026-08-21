/**
 * agent-notice.test.ts — AnnounceOnceLedger.
 *
 * The same screen is announced once per session. After the caller declares the
 * episode over, that screen may be announced again. Ledgers are per session.
 */

import { describe, expect, test } from "bun:test";
import { createAgentNotice } from "./agent-notice";

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
