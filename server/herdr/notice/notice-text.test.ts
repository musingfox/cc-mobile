/**
 * notice-text.test.ts — NoticeTextFromScreen + ScreenSecretRedaction.
 *
 * A raw terminal screen becomes a bounded, redacted fenced body — or nothing
 * when the screen has nothing to say. Secrets are shape-matched, not guessed
 * by entropy, so prose about keys and HTTP status lines stay intact.
 */

import { describe, expect, test } from "bun:test";
import { noticeTextFrom, redactSecrets } from "./notice-text";

describe("NoticeTextFromScreen", () => {
  test("T1: fences a short screen with a leading newline", () => {
    expect(noticeTextFrom("hi")).toBe("\n```\nhi\n```");
  });

  test("T2: whitespace-only screens yield nothing", () => {
    expect(noticeTextFrom("   \n\n \t\n")).toBeNull();
  });

  test("T3: empty screens yield nothing", () => {
    expect(noticeTextFrom("")).toBeNull();
  });

  test("T4: keeps only the last 20 lines", () => {
    const screen = Array.from({ length: 25 }, (_, i) => `l${i + 1}`).join("\n");
    const body = noticeTextFrom(screen)!;
    expect(body).toContain("l25");
    expect(body).toContain("l6");
    expect(body).not.toContain("l5");
  });

  test("T5: lengthens the wrapping fence past an inner backtick line", () => {
    const body = noticeTextFrom("```")!;
    const lines = body.split("\n");
    const firstFence = lines.find((l) => /^`+$/.test(l))!;
    const lastFence = [...lines].reverse().find((l) => /^`+$/.test(l))!;
    expect(firstFence.length).toBeGreaterThanOrEqual(4);
    expect(firstFence).toBe(lastFence);
  });

  test("T6: caps a long line at 2001 chars and ellipsizes the head", () => {
    const body = noticeTextFrom("x".repeat(5000))!;
    expect(body.length).toBeLessThanOrEqual(2001);
    expect(body.startsWith("\u2026")).toBe(true);
  });

  test("T7: redacts secrets before trimming so a dropped head cannot leak", () => {
    const body = noticeTextFrom("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF\ndone");
    expect(body).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF");
  });
});
