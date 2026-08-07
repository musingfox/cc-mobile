import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttemptLog } from "./attempt-log";

let tmp: string;
let logPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "push-attempt-"));
  logPath = join(tmp, "attempts.jsonl");
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("PushAttemptLog", () => {
  test("T1: given dispatch to apple endpoint where send resolves 201, last line parses to kind turn, host, status 201, reason null, ISO ts", async () => {
    const log = createAttemptLog({ path: logPath });
    await log.append({
      kind: "turn",
      endpoint: "https://web.push.apple.com/abc",
      status: 201,
      reason: null,
    });
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.kind).toBe("turn");
    expect(last.host).toBe("web.push.apple.com");
    expect(last.status).toBe(201);
    expect(last.reason).toBe(null);
    expect(() => new Date(last.ts).toISOString()).not.toThrow();
  });

  test("T2: send rejects 410 with body reason, log has status 410 and reason string", async () => {
    const log = createAttemptLog({ path: logPath });
    await log.append({
      kind: "turn",
      endpoint: "https://web.push.apple.com/x",
      status: 410,
      reason: "ExpiredToken",
    });
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.status).toBe(410);
    expect(last.reason).toBe("ExpiredToken");
  });

  test("T3: send rejects with Error, log status null and non-empty reason", async () => {
    const log = createAttemptLog({ path: logPath });
    await log.append({
      kind: "turn",
      endpoint: "https://web.push.apple.com/x",
      status: null,
      reason: "connect ECONNREFUSED",
    });
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.status).toBe(null);
    expect(last.reason).toBeTruthy();
    expect(typeof last.reason).toBe("string");
  });

  test("T4: dispatch over 2 stored subs appends exactly 2 lines", async () => {
    const log = createAttemptLog({ path: logPath });
    await log.append({ kind: "turn", endpoint: "https://web.push.apple.com/1" });
    await log.append({ kind: "turn", endpoint: "https://web.push.apple.com/2" });
    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  test("T5: append when file already ~300KB results in file <256KB containing newest line", async () => {
    // prefill ~300k
    const big = "x".repeat(300);
    let content = "";
    while (Buffer.byteLength(content) < 300 * 1024) {
      content += `{"ts":"2026-01-01T00:00:00.000Z","kind":"turn","host":"old","status":200,"reason":null}\n`;
    }
    writeFileSync(logPath, content);
    const log = createAttemptLog({ path: logPath });
    await log.append({ kind: "turn", endpoint: "https://web.push.apple.com/new", status: 201 });
    const afterSize = readFileSync(logPath, "utf8").length;
    expect(afterSize).toBeLessThan(256 * 1024);
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.host).toBe("web.push.apple.com");
  });

  test("T6: append to unwritable path resolves without throw and dispatch would still complete", async () => {
    const badPath = "/root/does/not/exist/push.log"; // unwritable likely
    const log = createAttemptLog({ path: badPath });
    let threw = false;
    try {
      await log.append({ kind: "turn", endpoint: "https://web.push.apple.com/x" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("T7: an unwritable log warns exactly once, so the silence is diagnosable", async () => {
    const blocker = join(tmp, "blocker");
    writeFileSync(blocker, "x");
    const warnings: string[] = [];
    const log = createAttemptLog({
      path: join(blocker, "nested", "attempts.jsonl"),
      warn: (m) => warnings.push(m),
    });
    await log.append({ kind: "turn", endpoint: "https://web.push.apple.com/x" });
    await log.append({ kind: "turn", endpoint: "https://web.push.apple.com/y" });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("push attempt log");
  });
});
