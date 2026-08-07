import { describe, expect, test } from "bun:test";
import { buildPayload } from "./payload";

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
