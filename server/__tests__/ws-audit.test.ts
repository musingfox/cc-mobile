import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAuditLog } from "../audit/audit-log";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;
let dir: string | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function setup() {
  dir = mkdtempSync(join(tmpdir(), "cc-mobile-audit-"));
  const path = join(dir, "audit.jsonl");
  const auditLog = createAuditLog({ path, warn: () => {} });
  return { path, auditLog };
}

function readRecord(path: string) {
  return JSON.parse(readFileSync(path, "utf8").trim());
}

function backend(overrides: Record<string, unknown> = {}) {
  return {
    createSession: async () => ({ name: "n", paneRef: "p1" }),
    teardown: async () => ({ killed: false }),
    listLive: () => [],
    send: async () => {},
    registerClient: () => {},
    cleanupByOwner: () => {},
    paneIdForRequest: () => "%1",
    resolvePermission: async () => true,
    ...overrides,
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe("ClientIdentityCapture", () => {
  test("records websocket address and user agent with a prompt", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(), undefined, {
      auditLog,
      headers: { "user-agent": "AuditProbe/1.0" },
    });

    harness.send({ type: "terminal_send", claudeUuid: "%1", content: "hello" });
    await settle();

    const record = JSON.parse(readFileSync(path, "utf8").trim());
    expect(record.ip).toBeTruthy();
    expect([null, "AuditProbe/1.0"]).toContain(record.device);
  });

  test("records the device query name instead of the user agent", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(), undefined, {
      auditLog,
      deviceName: "書房 Mac",
    });

    harness.send({ type: "terminal_send", claudeUuid: "%1", content: "hello" });
    await settle();

    expect(JSON.parse(readFileSync(path, "utf8").trim()).device).toBe("書房 Mac");
  });
});

describe("PermissionAnswerAudited", () => {
  test.each([
    [true, "owned"],
    [false, "unowned"],
  ])("records a pane lookup and %s ownership", async (resolved, outcome) => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(
      backend({
        paneIdForRequest: () => "%5",
        resolvePermission: async () => resolved,
      }),
      undefined,
      { auditLog },
    );

    harness.send({ type: "permission", requestId: "R", optionId: "1" });
    await settle();

    expect(readRecord(path)).toMatchObject({
      action: "permission_answer",
      paneId: "%5",
      outcome,
    });
  });

  test("records rejected when the answer form is missing and keeps the protocol error", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(), undefined, { auditLog });

    harness.send({ type: "permission", requestId: "R" });
    const error = await harness.waitFor((message) => message.type === "error");
    await settle();

    expect(error.code).toBe("invalid_message");
    expect(readRecord(path).outcome).toBe("rejected");
  });

  test("records failed without emitting a second error when resolution rejects", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(
      backend({
        resolvePermission: async () => {
          throw new Error("x");
        },
      }),
      undefined,
      { auditLog },
    );

    harness.send({ type: "permission", requestId: "R", optionId: "1" });
    await settle();

    expect(readRecord(path).outcome).toBe("failed");
    expect(harness.received.filter((message) => message.type === "error")).toEqual([]);
  });

  test("records unowned when the backend has no permission resolver", async () => {
    const { path, auditLog } = setup();
    // `delete` 需要 optional 屬性；改以解構省略同名鍵建出「沒有 resolvePermission
    // 的 backend」，語意相同而不必放寬型別。
    const { resolvePermission: _omitted, ...withoutResolver } = backend();
    harness = await startWsHarness(withoutResolver, undefined, { auditLog });

    harness.send({ type: "permission", requestId: "R", optionId: "1" });
    await settle();

    expect(readRecord(path).outcome).toBe("unowned");
  });
});

describe("PromptSendAudited", () => {
  test("records a dispatched prompt with its pane", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(), undefined, { auditLog });

    harness.send({ type: "terminal_send", claudeUuid: "%3", content: "hello" });
    await settle();

    expect(readRecord(path)).toMatchObject({
      action: "prompt_send",
      paneId: "%3",
      outcome: "dispatched",
    });
  });

  test.each([
    ["send", { send: async () => Promise.reject(new Error("boom")) }],
    [
      "permission resume",
      { resumePermissions: async () => Promise.reject(new Error("resume failed")) },
    ],
  ])("records failed when %s rejects", async (_step, overrides) => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(overrides), undefined, { auditLog });

    harness.send({ type: "terminal_send", claudeUuid: "%3", content: "hello" });
    const error = await harness.waitFor(
      (message) => message.type === "error" && message.code === "session_error",
    );
    await settle();

    expect(error.code).toBe("session_error");
    expect(readRecord(path).outcome).toBe("failed");
  });

  test("dispatches normally when no audit log is injected", async () => {
    const send = mock(async () => {});
    harness = await startWsHarness(backend({ send }));

    harness.send({ type: "terminal_send", claudeUuid: "%3", content: "hello" });
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(harness.received.filter((message) => message.type === "error")).toEqual([]);
  });
});

describe("AuditCarriesNoUserText", () => {
  test("prompt content is never written", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(), undefined, { auditLog });

    harness.send({
      type: "terminal_send",
      claudeUuid: "%1",
      content: "AUDIT-SENTINEL-9f3a please rm -rf /tmp/x",
    });
    await settle();

    const line = readFileSync(path, "utf8").trim();
    expect(line.includes("AUDIT-SENTINEL-9f3a")).toBe(false);
    expect(JSON.parse(line).action).toBe("prompt_send");
  });

  test("permission answers are never written", async () => {
    const { path, auditLog } = setup();
    harness = await startWsHarness(backend(), undefined, { auditLog });

    harness.send({
      type: "permission",
      requestId: "perm-1",
      optionId: "1",
      answers: { why: "AUDIT-SENTINEL-ANS-7c1" },
    });
    await settle();

    const line = readFileSync(path, "utf8").trim();
    expect(line.includes("AUDIT-SENTINEL-ANS-7c1")).toBe(false);
    expect(JSON.parse(line).action).toBe("permission_answer");
  });
});

describe("AuditLogWriteFailureIsInert", () => {
  test("still dispatches a prompt without a websocket error", async () => {
    dir = mkdtempSync(join(tmpdir(), "cc-mobile-audit-"));
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "");
    const auditLog = createAuditLog({
      path: join(blocker, "nested", "audit.jsonl"),
      warn: () => {},
    });
    const send = mock(async () => {});
    harness = await startWsHarness(backend({ send }), undefined, { auditLog });

    harness.send({ type: "terminal_send", claudeUuid: "%1", content: "hello" });
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(harness.received.some((message) => message.type === "error")).toBe(false);
  });
});
