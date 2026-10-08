import { describe, expect, test } from "bun:test";
import { composeLaunchPrompt } from "../launch-prompt";

const CARD = "# 任務\n第一行 CARD-BODY\n第二行：內容";
const RULE_MARKERS = ["AskUserQuestion", "/clear", "結果：完成", "結果：需要你", "結果：失敗"];

describe("composeLaunchPrompt", () => {
  const out = composeLaunchPrompt("CARD-BODY");

  test("T1 mentions AskUserQuestion", () => {
    expect(out).toContain("AskUserQuestion");
  });
  test("T2 mentions /clear", () => {
    expect(out).toContain("/clear");
  });
  test("T3 names the three result lines", () => {
    for (const s of ["結果：完成", "結果：需要你", "結果：失敗"]) expect(out).toContain(s);
  });
  test("T4 rules come before the card", () => {
    const at = out.indexOf("CARD-BODY");
    for (const s of RULE_MARKERS) expect(at).toBeGreaterThan(out.indexOf(s));
  });
  test("T5 card text kept verbatim", () => {
    expect(composeLaunchPrompt(CARD)).toContain(CARD);
  });
  test("T6 deterministic", () => {
    expect(composeLaunchPrompt("x")).toBe(composeLaunchPrompt("x"));
  });
});
