import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditLog } from "../../audit/audit-log";
import { createNativePermission } from "./native-permission";

const SCREEN = readFileSync(join(import.meta.dir, "fixtures", "blocked-bash-prompt.txt"), "utf8");

function fakeClock() {
  let timer: (() => void) | undefined;
  return {
    setTimeoutFn: (fn: () => void) => {
      timer = fn;
      return 1;
    },
    clearTimeoutFn: () => {},
    fire: () => timer?.(),
  };
}

describe("AutoDenyKeysSendAudited", () => {
  test.each([
    ["sent" as const, false],
    ["failed" as const, true],
  ])("reports one %s outcome after the guarded auto-deny", async (outcome, rejectSend) => {
    const clock = fakeClock();
    const { promise: reported, resolve: report } = Promise.withResolvers<void>();
    const observed: unknown[][] = [];
    const permission = createNativePermission({
      client: {
        agentGet: async () => ({ agent_status: "blocked" }),
        paneRead: async () => ({ text: SCREEN, revision: 1 }),
        paneSendKeys: async () => {
          if (rejectSend) throw new Error("send failed");
        },
      },
      getSink: () => undefined,
      originOf: () => "self",
      newRequestId: () => "perm-auto",
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      warn: () => {},
      onKeysSent: (...args) => {
        observed.push(args);
        report();
      },
    });

    await permission.onStatus("%1", "blocked");
    clock.fire();
    await reported;

    expect(observed).toEqual([["%1", "auto_deny", outcome]]);
  });

  test("does not report or send after the pane leaves blocked", async () => {
    const clock = fakeClock();
    const observed: unknown[][] = [];
    let sends = 0;
    let status = "blocked";
    const permission = createNativePermission({
      client: {
        agentGet: async () => ({ agent_status: status }),
        paneRead: async () => ({ text: SCREEN, revision: 1 }),
        paneSendKeys: async () => {
          sends += 1;
        },
      },
      getSink: () => undefined,
      originOf: () => "self",
      newRequestId: () => "perm-auto",
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      onKeysSent: (...args) => {
        observed.push(args);
      },
    });

    await permission.onStatus("%1", "blocked");
    status = "idle";
    clock.fire();
    await Promise.resolve();

    expect(observed).toEqual([]);
    expect(sends).toBe(0);
  });

  test("does not arm an observer event for a foreign pane", async () => {
    const clock = fakeClock();
    const observed: unknown[][] = [];
    const permission = createNativePermission({
      client: {
        agentGet: async () => ({ agent_status: "blocked" }),
        paneRead: async () => ({ text: SCREEN, revision: 1 }),
        paneSendKeys: async () => {},
      },
      getSink: () => undefined,
      originOf: () => "foreign",
      newRequestId: () => "perm-auto",
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
      onKeysSent: (...args) => {
        observed.push(args);
      },
    });

    await permission.onStatus("%1", "blocked");
    clock.fire();

    expect(observed).toEqual([]);
  });
});

describe("AuditCarriesNoUserText — native key send", () => {
  test("pane errors never enter the audit record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-mobile-native-audit-"));
    const path = join(dir, "audit.jsonl");
    const auditLog = createAuditLog({ path, warn: () => {} });
    const permission = createNativePermission({
      client: {
        agentGet: async () => ({ agent_status: "blocked" }),
        paneRead: async () => ({ text: SCREEN, revision: 1 }),
        paneSendKeys: async () => {
          throw new Error("AUDIT-SENTINEL-ERR-4b2 in pane %9");
        },
      },
      getSink: () => () => {},
      originOf: () => "foreign",
      newRequestId: () => "perm-1",
      warn: () => {},
      onKeysSent: (paneId, source, outcome) =>
        auditLog.append({
          action: source === "auto_deny" ? "auto_deny" : "permission_keys_send",
          paneId,
          ip: null,
          device: null,
          outcome,
        }),
    });

    try {
      await permission.onStatus("%9", "blocked");
      await permission.resolve("perm-1", { optionId: "1" });
      const line = readFileSync(path, "utf8").trim();
      expect(JSON.parse(line).outcome).toBe("failed");
      expect(line.includes("AUDIT-SENTINEL-ERR-4b2")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
