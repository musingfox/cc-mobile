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
