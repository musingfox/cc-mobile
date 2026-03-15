import { describe, expect, test } from "bun:test";
import { createPermissionHandler } from "../permission-bridge";

const signal = AbortSignal.timeout(60000);

describe("Permission Bridge", () => {
  test("canUseTool approval", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId) => {
      capturedRequestId = requestId;
    });
    const promise = handler.canUseTool("Read", { file_path: "/a" }, { toolUseID: "t1", signal });
    handler.resolvePermission(capturedRequestId, true);
    const result = await promise;
    expect(result.behavior).toBe("allow");
  });

  test("canUseTool denial", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId) => {
      capturedRequestId = requestId;
    });
    const promise = handler.canUseTool("Write", { file_path: "/b" }, { toolUseID: "t2", signal });
    handler.resolvePermission(capturedRequestId, false);
    const result = await promise;
    expect(result.behavior).toBe("deny");
  });

  test("resolvePermission unknown requestId is no-op", () => {
    const handler = createPermissionHandler(() => {});
    expect(() => handler.resolvePermission("unknown", true)).not.toThrow();
  });

  test("canUseTool timeout", async () => {
    const handler = createPermissionHandler(() => {}, { timeoutMs: 100 });
    const result = await handler.canUseTool(
      "Edit",
      { file_path: "/c" },
      { toolUseID: "t3", signal },
    );
    expect(result.behavior).toBe("deny");
  }, 5000);
});
