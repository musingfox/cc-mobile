import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditLog } from "../../audit/audit-log";
import { createNativePermission } from "./native-permission";

const SCREEN = readFileSync(join(import.meta.dir, "fixtures", "blocked-bash-prompt.txt"), "utf8");

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
