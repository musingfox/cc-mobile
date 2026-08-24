import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createAuditLog } from "./audit-log";

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
