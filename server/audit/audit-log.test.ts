import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, createAuditLog } from "./audit-log";

const tempDirs: string[] = [];

function temporaryAuditPath() {
  const root = mkdtempSync(join(tmpdir(), "cc-mobile-audit-"));
  tempDirs.push(root);
  return join(root, "nested", "audit.jsonl");
}

function jsonLineOfSize(size: number) {
  return `${JSON.stringify("x".repeat(size - 3))}\n`;
}

const record = {
  action: "prompt_send" as const,
  paneId: "%1",
  ip: null,
  device: null,
  outcome: "dispatched" as const,
};

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("audit log directory mode", () => {
  test("creates the containing directory with mode 0700", async () => {
    const path = temporaryAuditPath();

    await createAuditLog({ path }).append(record);

    expect(existsSync(dirname(path))).toBe(true);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(readFileSync(path, "utf8")).not.toBe("");
  });

  test("tightens an existing containing directory to mode 0700", async () => {
    const path = temporaryAuditPath();
    mkdirSync(dirname(path), { recursive: true });
    chmodSync(dirname(path), 0o755);

    await createAuditLog({ path }).append(record);

    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });

  test("uses the private audit subdirectory without touching disk", () => {
    const path = createAuditLog().getPath();

    expect(path.endsWith("/.claude-mobile/audit/audit.jsonl")).toBe(true);
    expect(basename(dirname(path))).toBe("audit");
  });
});

describe("audit log file mode", () => {
  test("creates the active file with mode 0600", async () => {
    const path = temporaryAuditPath();

    await createAuditLog({ path }).append(record);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("tightens an existing active file to mode 0600", async () => {
    const path = temporaryAuditPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
    chmodSync(path, 0o644);

    await createAuditLog({ path }).append(record);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("keeps active and rotated files at mode 0600", async () => {
    const path = temporaryAuditPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, " ".repeat(5 * 1024 * 1024));

    await createAuditLog({ path }).append(record);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(`${path}.1`).mode & 0o777).toBe(0o600);
  });
});

describe("audit log rotation", () => {
  test("rotates an oversized file and starts a one-record active file", async () => {
    const path = temporaryAuditPath();
    const size = 5 * 1024 * 1024 + 1;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, jsonLineOfSize(size));

    await createAuditLog({ path }).append({ ...record, paneId: "%9" });

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).paneId).toBe("%9");
    expect(statSync(`${path}.1`).size).toBe(size);
  });

  test("does not rotate a file below the limit", async () => {
    const path = temporaryAuditPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, jsonLineOfSize(1024));

    await createAuditLog({ path }).append(record);

    expect(existsSync(`${path}.1`)).toBe(false);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  });

  test("keeps only the latest rotated file", async () => {
    const path = temporaryAuditPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.1`, "OLD");
    writeFileSync(path, jsonLineOfSize(5 * 1024 * 1024));

    await createAuditLog({ path }).append(record);

    expect(readFileSync(`${path}.1`, "utf8")).not.toContain("OLD");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("audit log write failures", () => {
  test("resolves every append and warns only once", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-mobile-audit-"));
    tempDirs.push(root);
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "");
    const warnings: string[] = [];
    const log = createAuditLog({
      path: join(blocker, "nested", "audit.jsonl"),
      warn: (message) => warnings.push(message),
    });

    await expect(log.append(record)).resolves.toBeUndefined();
    await expect(log.append(record)).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("audit log");
  });
});

describe("audit record shape", () => {
  test("writes exactly the six public fields with an ISO timestamp", async () => {
    const path = temporaryAuditPath();

    await createAuditLog({ path }).append({
      action: "prompt_send",
      paneId: "%1",
      ip: "::ffff:127.0.0.1",
      device: "UA/1",
      outcome: "dispatched",
    });

    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(saved).sort()).toEqual([
      "action",
      "device",
      "ip",
      "outcome",
      "paneId",
      "ts",
    ]);
    expect(saved.action).toBe("prompt_send");
    expect(saved.paneId).toBe("%1");
    expect(saved.outcome).toBe("dispatched");
    expect(new Date(saved.ts).toISOString()).toBe(saved.ts);
  });

  test("preserves null identity fields instead of omitting them", async () => {
    const path = temporaryAuditPath();

    await createAuditLog({ path }).append({
      action: "permission_keys_send",
      paneId: null,
      ip: null,
      device: null,
      outcome: "sent",
    });

    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(saved)).toHaveLength(6);
    expect(saved.paneId).toBeNull();
  });

  test("accepts only the four actions and six outcomes", async () => {
    const path = temporaryAuditPath();
    const log = createAuditLog({ path });

    for (const action of AUDIT_ACTIONS) {
      await log.append({ ...record, action });
    }

    const saved = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(saved).toHaveLength(4);
    expect(saved.every((item) => AUDIT_ACTIONS.includes(item.action))).toBe(true);
    expect(AUDIT_ACTIONS).toHaveLength(4);
    expect(AUDIT_OUTCOMES).toHaveLength(6);
    // 名稱本身就是磁碟格式：第一行寫下去之後，這四個詞就是日後每一次
    // grep 這份稽核檔所用的詞，改名等於讓既有紀錄變成讀不懂的資料。
    // 只釘長度與集合成員抓不到改名（一次真實漂移就是這樣溜過閘門的），
    // 所以逐字釘死。
    expect([...AUDIT_ACTIONS]).toEqual([
      "prompt_send",
      "permission_answer",
      "permission_keys_send",
      "auto_deny_keys_send",
    ]);
    expect([...AUDIT_OUTCOMES]).toEqual([
      "dispatched",
      "failed",
      "owned",
      "unowned",
      "rejected",
      "sent",
    ]);
  });

  test("keeps consecutive records independently parseable", async () => {
    const path = temporaryAuditPath();
    const log = createAuditLog({ path });

    await log.append(record);
    await log.append(record);

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });
});
