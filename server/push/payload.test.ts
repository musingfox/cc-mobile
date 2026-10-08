import { describe, expect, test } from "bun:test";
import { buildPayload, PROJECT_NAME_MAX } from "./payload";

describe("PushPayloadCopy", () => {
  test("T1: permission payload", () => {
    expect(buildPayload("permission")).toEqual({
      kind: "permission",
      title: "CCMobile",
      body: "Permission needed",
      tag: "cc-mobile-push-permission",
    });
  });
  test("T2: turn payload", () => {
    expect(buildPayload("turn")).toEqual({
      kind: "turn",
      title: "CCMobile",
      body: "A turn finished",
      tag: "cc-mobile-push-turn",
    });
  });
  test("T3: json <=4096", () => {
    expect(JSON.stringify(buildPayload("permission")).length).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(buildPayload("turn")).length).toBeLessThanOrEqual(4096);
  });
  test("T4: no project/cwd/tool/uuid in stringified", () => {
    const p = JSON.stringify(buildPayload("turn")) + JSON.stringify(buildPayload("permission"));
    expect(p).not.toMatch(/\/Users/);
    expect(p).not.toMatch(/cc-mobile-permission-/);
    expect(p).not.toMatch(/Bash/);
    expect(p).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

describe("PushNamesTheProjectNeverTheWork", () => {
  const CWD = "/Users/nick/workspace/secret-proj";

  test("a turn of one pane names that pane's project", () => {
    expect(buildPayload("turn", { cwd: CWD })).toEqual({
      kind: "turn",
      title: "CCMobile",
      body: "A turn finished in secret-proj",
      tag: "cc-mobile-push-turn",
    });
  });

  test("a merged turn of several panes carries only their number", () => {
    expect(buildPayload("turn", { count: 3 })).toEqual({
      kind: "turn",
      title: "CCMobile",
      body: "3 sessions finished",
      tag: "cc-mobile-push-turn",
    });
  });

  test("a blocked pane names its project", () => {
    expect(buildPayload("permission", { cwd: CWD })).toEqual({
      kind: "permission",
      title: "CCMobile",
      body: "Permission needed in secret-proj",
      tag: "cc-mobile-push-permission",
    });
  });

  test("only the basename leaves: no path above it", () => {
    const p = JSON.stringify(buildPayload("turn", { cwd: CWD }));
    expect(p).toContain("secret-proj");
    expect(p).not.toMatch(/\/Users|nick|workspace/);
  });

  test("a trailing slash still names the directory", () => {
    expect(buildPayload("turn", { cwd: `${CWD}/` }).body).toBe("A turn finished in secret-proj");
  });

  test.each([
    ["null", null],
    ["empty", ""],
    ["the root", "/"],
    ["whitespace", "/srv/   "],
  ])("a cwd that is %s falls back to today's exact generic copy", (_label, cwd) => {
    expect(buildPayload("turn", { cwd })).toEqual(buildPayload("turn"));
    expect(buildPayload("permission", { cwd })).toEqual(buildPayload("permission"));
    expect(buildPayload("turn", { cwd }).body).toBe("A turn finished");
    expect(buildPayload("permission", { cwd }).body).toBe("Permission needed");
  });

  test("a count below two is not a merge, and says nothing it cannot back", () => {
    expect(buildPayload("turn", { count: 1 })).toEqual(buildPayload("turn"));
  });

  test("a pathological basename is cut to PROJECT_NAME_MAX and the payload stays far under 4 KB", () => {
    // Multi-byte on purpose: the limit APNs enforces is bytes, not characters.
    const name = "專".repeat(5000);
    for (const kind of ["turn", "permission"] as const) {
      const payload = buildPayload(kind, { cwd: `/srv/${name}` });
      const project = payload.body.split(" in ")[1] ?? "";
      expect(Array.from(project)).toHaveLength(PROJECT_NAME_MAX + 1);
      expect(project.endsWith("…")).toBe(true);
      // Room left for the aes128gcm envelope the push service also counts.
      expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThan(4096 - 200);
    }
  });

  test("the cut never splits a character in half", () => {
    const name = "🦊".repeat(PROJECT_NAME_MAX + 10);
    const project = buildPayload("turn", { cwd: `/srv/${name}` }).body.split(" in ")[1] ?? "";
    expect(project).toBe(`${"🦊".repeat(PROJECT_NAME_MAX)}…`);
  });

  test("a name at the limit is sent whole", () => {
    const name = "a".repeat(PROJECT_NAME_MAX);
    expect(buildPayload("turn", { cwd: `/srv/${name}` }).body).toBe(`A turn finished in ${name}`);
  });
});

describe("HangarOfflinePayload", () => {
  test("says only that the hangar is offline", () => {
    expect(buildPayload("hangar_offline")).toEqual({
      kind: "hangar_offline",
      title: "CCMobile",
      body: "Hangar offline",
      tag: "cc-mobile-push-hangar-offline",
    });
  });

  test("never names a project", () => {
    expect(buildPayload("hangar_offline", { cwd: "/work/secret-project" }).body).toBe(
      "Hangar offline",
    );
  });
});
