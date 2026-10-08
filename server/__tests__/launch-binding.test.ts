import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLaunchesDir, type LaunchBinding, writeLaunchBinding } from "../launch-binding";

const UUID = "3f2a9b01-1111-4222-8333-444455556666";
const binding: LaunchBinding = {
  cardPath: "pm/cc-mobile/tasks/x.md",
  vault: "obsidian",
  project: "cc-mobile",
  paneId: "fleet@w1:p2",
  createdAt: "2026-10-08T10:32:16.361Z",
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "launch-binding-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const mode = (p: string) => statSync(p).mode & 0o777;

describe("LaunchBindingWriter", () => {
  test("T1 writes exactly the binding as JSON", async () => {
    const dir = join(tmp, "launches");
    await writeLaunchBinding(dir, UUID, binding);
    expect(JSON.parse(readFileSync(join(dir, `${UUID}.json`), "utf8"))).toEqual(binding);
  });
  test("T2 dir is 0700 and file is 0600", async () => {
    const dir = join(tmp, "launches");
    await writeLaunchBinding(dir, UUID, binding);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, `${UUID}.json`))).toBe(0o600);
  });
  test("T3 an existing looser dir is tightened", async () => {
    const dir = join(tmp, "launches");
    mkdirSync(dir);
    chmodSync(dir, 0o755);
    await writeLaunchBinding(dir, UUID, binding);
    expect(mode(dir)).toBe(0o700);
  });
  test("T4 a second write for the same id rejects and leaves the file alone", async () => {
    const dir = join(tmp, "launches");
    await writeLaunchBinding(dir, UUID, { ...binding, cardPath: "a.md" });
    await expect(writeLaunchBinding(dir, UUID, { ...binding, cardPath: "b.md" })).rejects.toThrow();
    expect(JSON.parse(readFileSync(join(dir, `${UUID}.json`), "utf8")).cardPath).toBe("a.md");
  });
  test("T5 a dir under a regular file rejects", async () => {
    writeFileSync(join(tmp, "afile"), "x");
    await expect(writeLaunchBinding(join(tmp, "afile", "sub"), UUID, binding)).rejects.toThrow();
  });
  test("T6 extra properties are not written", async () => {
    const dir = join(tmp, "launches");
    await writeLaunchBinding(dir, UUID, { ...binding, token: "s3cret" } as LaunchBinding);
    const text = readFileSync(join(dir, `${UUID}.json`), "utf8");
    expect(Object.keys(JSON.parse(text)).sort()).toEqual([
      "cardPath",
      "createdAt",
      "paneId",
      "project",
      "vault",
    ]);
    expect(text).not.toContain("s3cret");
  });
});

describe("LaunchesDirDefault", () => {
  test("T1 lives under ~/.claude-mobile/launches", () => {
    expect(defaultLaunchesDir("/home/u")).toBe("/home/u/.claude-mobile/launches");
  });
});
