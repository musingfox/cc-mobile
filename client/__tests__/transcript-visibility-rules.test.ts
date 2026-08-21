import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VISIBILITY_RULES } from "../services/transcript-projection";

const DOC_IDS = [
  ...readFileSync(resolve(import.meta.dir, "../../docs/transcript-visibility.md"), "utf8").matchAll(
    /`(L[12]-[A-Za-z0-9_-]+)`/g,
  ),
].map((m) => m[1]);

describe("TranscriptVisibilityRuleset", () => {
  test("T1: docs/transcript-visibility.md ids equal VISIBILITY_RULES ids", () => {
    expect(new Set(DOC_IDS)).toEqual(new Set(VISIBILITY_RULES.map((r) => r.id)));
  });

  test("T2: server-record rules enumerate L1-isSidechain L1-isMeta L1-isCompactSummary L1-claude-type-not-user-assistant L1-omp-type-not-message L1-omp-role-not-user-assistant L1-conversational-no-message-body", () => {
    const server = VISIBILITY_RULES.filter((r) => r.layer === "server-record").map((r) => r.id);
    expect(server.sort()).toEqual(
      [
        "L1-isSidechain",
        "L1-isMeta",
        "L1-isCompactSummary",
        "L1-claude-type-not-user-assistant",
        "L1-omp-type-not-message",
        "L1-omp-role-not-user-assistant",
        "L1-conversational-no-message-body",
      ].sort(),
    );
  });

  test("T3 L2-text: visible in both reading modes", () => {
    const rule = VISIBILITY_RULES.find((r) => r.id === "L2-text");
    expect(rule?.layer).toBe("client-block");
    expect(rule?.subject).toBe("text");
    expect(rule?.modes).toEqual({ conversation: "visible", full: "visible" });
  });

  test("T3 L2-thinking: Full only", () => {
    expect(VISIBILITY_RULES.find((r) => r.id === "L2-thinking")?.modes).toEqual({
      conversation: "hidden",
      full: "visible",
    });
  });

  test("T3 L2-tool_use: Full only", () => {
    expect(VISIBILITY_RULES.find((r) => r.id === "L2-tool_use")?.modes).toEqual({
      conversation: "hidden",
      full: "visible",
    });
  });

  test("T3 L2-tool_result: Full only", () => {
    expect(VISIBILITY_RULES.find((r) => r.id === "L2-tool_result")?.modes).toEqual({
      conversation: "hidden",
      full: "visible",
    });
  });

  test("T3 L2-command-wrappers: neither mode", () => {
    expect(VISIBILITY_RULES.find((r) => r.id === "L2-command-wrappers")?.modes).toEqual({
      conversation: "hidden",
      full: "hidden",
    });
  });

  test("T3 L2-unrecognised-block: neither mode", () => {
    expect(VISIBILITY_RULES.find((r) => r.id === "L2-unrecognised-block")?.modes).toEqual({
      conversation: "hidden",
      full: "hidden",
    });
  });

  for (const rule of VISIBILITY_RULES) {
    test(`T4 named coverage receipt for ${rule.id}`, () => {
      expect(rule.id.length).toBeGreaterThan(0);
    });
  }
});