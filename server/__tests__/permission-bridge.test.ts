import { describe, test, expect } from "bun:test";
import { createPermissionHandler } from "../permission-bridge";

describe("Permission Bridge", () => {
  test("canUseTool approval", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId, tool) => {
      capturedRequestId = requestId;
    });
    const promise = handler.canUseTool("Read", { file_path: "/a" }, { toolUseID: "t1" });
    handler.resolvePermission(capturedRequestId, true);
    const result = await promise;
    expect(result.behavior).toBe("allow");
    expect(result.toolUseID).toBe("t1");
  });

  test("canUseTool denial", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId, tool) => {
      capturedRequestId = requestId;
    });
    const promise = handler.canUseTool("Write", { file_path: "/b" }, { toolUseID: "t2" });
    handler.resolvePermission(capturedRequestId, false);
    const result = await promise;
    expect(result.behavior).toBe("deny");
    expect(result.toolUseID).toBe("t2");
  });

  test("resolvePermission unknown requestId is no-op", () => {
    const handler = createPermissionHandler(() => {});
    expect(() => handler.resolvePermission("unknown", true)).not.toThrow();
  });

  test("canUseTool timeout", async () => {
    const handler = createPermissionHandler(() => {}, { timeoutMs: 100 });
    const result = await handler.canUseTool("Edit", { file_path: "/c" }, { toolUseID: "t3" });
    expect(result.behavior).toBe("deny");
    expect(result.toolUseID).toBe("t3");
  }, 5000);
});
