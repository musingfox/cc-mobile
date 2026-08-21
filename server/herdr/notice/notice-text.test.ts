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

describe("ScreenSecretRedaction", () => {
  test("T1: redacts a JWT after Authorization: Bearer", () => {
    const out = redactSecrets(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456",
    );
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out.startsWith("Authorization:")).toBe(true);
  });

  test("T2: redacts an Anthropic API key in an env assignment", () => {
    const out = redactSecrets("ANTHROPIC_API_KEY=sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF");
    expect(out).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF");
    expect(out).toContain("[redacted]");
  });

  test("T3: redacts an xAI key while keeping the 401 prose", () => {
    const out = redactSecrets("xai request failed (401): key xai-9f8e7d6c5b4a3f2e1d0c9b8a7");
    expect(out).toContain("xai request failed (401)");
    expect(out).not.toContain("xai-9f8e7d6c5b4a3f2e1d0c9b8a7");
  });

  test("T4: redacts a GitHub token", () => {
    const out = redactSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(out).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
  });

  test("T4b: redacts a $$CREDENTIAL_…$$ wrapper", () => {
    const out = redactSecrets("token: $$CREDENTIAL_R3XKAAHRGEB4:M$$");
    expect(out).not.toContain("$$CREDENTIAL_R3XKAAHRGEB4:M$$");
  });

  test("T5: redacts a labeled password value", () => {
    const out = redactSecrets("password: hunter2hunter2");
    expect(out).not.toContain("hunter2hunter2");
  });

  test("T6: leaves prose that names a credential untouched", () => {
    expect(redactSecrets("Error: No API key found for anthropic.")).toBe(
      "Error: No API key found for anthropic.",
    );
  });

  test("T7: leaves a 429 status line byte-for-byte", () => {
    const line = "429 Too Many Requests \u2014 retries exhausted (xai/grok-2)";
    expect(redactSecrets(line)).toBe(line);
  });

  test("T8: leaves a file path untouched", () => {
    const path = "/Users/nick/workspace/cc-mobile/server/herdr/notice/agent-notice.ts:44";
    expect(redactSecrets(path)).toBe(path);
  });

  test("T9: redacts an OpenAI project key", () => {
    const key = "sk-proj-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH";
    expect(redactSecrets(`OPENAI_API_KEY=${key}`)).not.toContain(key);
  });

  test("T10: redacts a Slack bot token", () => {
    // Synthetic fixture, kept in Slack's real shape so the rule is tested
    // against what it must catch — hence the scanner exemption.
    const token = "xoxb-2468013579-1357924680-AbCdEfGhIjKlMnOpQrStUvWx"; // gitleaks:allow
    expect(redactSecrets(`slack post failed: ${token}`)).not.toContain(token);
  });

  test("T11: redacts an AWS access key id", () => {
    const key = "AKIAIOSFODNN7EXAMPLE";
    expect(redactSecrets(`aws_access_key_id = ${key}`)).not.toContain(key);
  });

  test("T12: redacts a password value behind an equals sign", () => {
    expect(redactSecrets("PASSWORD=hunter2hunter2")).not.toContain("hunter2hunter2");
  });

  test("T13: leaves a bare 64-char hex string alone (checksums are not tokens)", () => {
    const line = `sha256 ${"a1b2c3d4".repeat(8)}`;
    expect(redactSecrets(line)).toBe(line);
  });
});
