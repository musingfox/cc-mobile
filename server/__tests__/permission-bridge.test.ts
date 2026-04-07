import { describe, expect, mock, test } from "bun:test";
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

  test("single-question answers map", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId) => {
      capturedRequestId = requestId;
    });

    const promise = handler.canUseTool(
      "AskUserQuestion",
      {
        questions: [
          {
            question: "Which language?",
            header: "Language",
            options: [
              { label: "Python", description: "Python desc" },
              { label: "Go", description: "Go desc" },
            ],
            multiSelect: false,
          },
        ],
      },
      { signal, toolUseID: "req_2" },
    );

    handler.resolvePermission(capturedRequestId, true, { "Which language?": "Python" });

    const result = await promise;
    expect(result.behavior).toBe("allow");
    expect(result.updatedInput).toEqual({
      questions: [
        {
          question: "Which language?",
          header: "Language",
          options: [
            { label: "Python", description: "Python desc" },
            { label: "Go", description: "Go desc" },
          ],
          multiSelect: false,
        },
      ],
      answers: { "Which language?": "Python" },
    });
  });

  test("multi-question answers map", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId) => {
      capturedRequestId = requestId;
    });

    const promise = handler.canUseTool(
      "AskUserQuestion",
      {
        questions: [
          { question: "Which language?", options: [{ label: "Python" }] },
          { question: "Which framework?", options: [{ label: "FastAPI" }] },
        ],
      },
      { signal, toolUseID: "req_3" },
    );

    handler.resolvePermission(capturedRequestId, true, {
      "Which language?": "Python",
      "Which framework?": "FastAPI",
    });

    const result = await promise;
    expect(result.behavior).toBe("allow");
    expect(result.updatedInput).toEqual({
      questions: [
        { question: "Which language?", options: [{ label: "Python" }] },
        { question: "Which framework?", options: [{ label: "FastAPI" }] },
      ],
      answers: {
        "Which language?": "Python",
        "Which framework?": "FastAPI",
      },
    });
  });

  test("empty answers map returns undefined updatedInput", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId) => {
      capturedRequestId = requestId;
    });

    const promise = handler.canUseTool("Bash", { command: "ls" }, { signal, toolUseID: "req_4" });

    handler.resolvePermission(capturedRequestId, true, {});

    const result = await promise;
    expect(result.behavior).toBe("allow");
    expect(result.updatedInput).toBeUndefined();
  });

  test("resolvePermission without answer returns no updatedInput", async () => {
    let capturedRequestId = "";
    const handler = createPermissionHandler((requestId) => {
      capturedRequestId = requestId;
    });

    const promise = handler.canUseTool("Bash", { command: "ls" }, { signal, toolUseID: "req_1" });

    handler.resolvePermission(capturedRequestId, true);

    const result = await promise;
    expect(result.behavior).toBe("allow");
    expect(result.updatedInput).toBeUndefined();
  });

  describe("pausePending", () => {
    test("captures pending permission state", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient);

      // Create a pending permission
      const promise = handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Pause immediately
      const snapshots = handler.pausePending();

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].requestId).toBe("req-123");
      expect(snapshots[0].toolName).toBe("Bash");
      expect(snapshots[0].input).toEqual({ command: "ls" });
      expect(snapshots[0].sessionId).toBe("session-1");
      expect(snapshots[0].elapsedMs).toBeGreaterThanOrEqual(0);
      expect(snapshots[0].elapsedMs).toBeLessThan(100); // Should be very small

      // Promise should still be pending (not resolved)
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(resolved).toBe(false);
    });

    test("clears timeouts after pause", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient, { timeoutMs: 100 });

      // Create a pending permission with short timeout
      const promise = handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Pause
      handler.pausePending();

      // Wait past the original timeout period
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Promise should still be pending (timeout was cleared)
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(resolved).toBe(false);
    });
  });

  describe("resumePending", () => {
    test("extends timeout after pause/resume", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient, { timeoutMs: 1000 });

      // Create a pending permission
      const promise = handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Wait a bit, then pause
      await new Promise((resolve) => setTimeout(resolve, 100));
      const snapshots = handler.pausePending();

      expect(snapshots[0].elapsedMs).toBeGreaterThanOrEqual(90);
      expect(snapshots[0].elapsedMs).toBeLessThan(200);

      // Resume
      handler.resumePending(snapshots);

      // Promise should still be pending (not denied yet)
      let resolved = false;
      let result: any = null;
      promise.then((res) => {
        resolved = true;
        result = res;
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(resolved).toBe(false);

      // Should timeout after remaining time (~900ms)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(resolved).toBe(true);
      expect(result.behavior).toBe("deny");
    }, 5000);

    test("resends permission_request on resume", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient, { timeoutMs: 60000 });

      // Create a pending permission
      handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Get initial call count
      const initialCallCount = sendToClient.mock.calls.length;
      expect(initialCallCount).toBe(1); // Initial permission_request

      // Pause and resume
      const snapshots = handler.pausePending();
      handler.resumePending(snapshots);

      // Should have re-sent permission_request (total 2 calls)
      expect(sendToClient).toHaveBeenCalledTimes(2);
      expect(sendToClient.mock.calls[1]).toEqual([
        "req-123",
        {
          name: "Bash",
          parameters: { command: "ls" },
        },
      ]);
    });

    test("immediately denies expired permissions", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient, { timeoutMs: 100 });

      // Create a pending permission
      const promise = handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Wait most of the timeout
      await new Promise((resolve) => setTimeout(resolve, 90));

      // Pause
      const snapshots = handler.pausePending();

      // Wait past the original timeout
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Resume - should immediately deny since elapsedMs >= timeoutMs
      handler.resumePending(snapshots);

      // Promise should resolve immediately with deny
      const result = await promise;
      expect(result.behavior).toBe("deny");
      expect(result.message).toContain("timeout");
    }, 5000);

    test("updates sendToClient callback on reconnect", async () => {
      const oldSendToClient = mock(() => {});
      const handler = createPermissionHandler(oldSendToClient, { timeoutMs: 60000 });

      // Create a pending permission
      handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Pause
      const snapshots = handler.pausePending();

      // Update to new connection
      const newSendToClient = mock(() => {});
      handler.updateSendToClient(newSendToClient);

      // Resume - should use new sendToClient
      handler.resumePending(snapshots);

      expect(oldSendToClient).toHaveBeenCalledTimes(1); // Only initial call
      expect(newSendToClient).toHaveBeenCalledTimes(1); // Resume call
      expect(newSendToClient).toHaveBeenCalledWith("req-123", {
        name: "Bash",
        parameters: { command: "ls" },
      });
    });
  });

  describe("permission resolution after resume", () => {
    test("can approve resumed permission", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient, { timeoutMs: 60000 });

      // Create a pending permission
      const promise = handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Pause and resume
      const snapshots = handler.pausePending();
      handler.resumePending(snapshots);

      // Approve the permission
      handler.resolvePermission("req-123", true);

      // Promise should resolve with allow
      const result = await promise;
      expect(result.behavior).toBe("allow");
    });

    test("can deny resumed permission", async () => {
      const sendToClient = mock(() => {});
      const handler = createPermissionHandler(sendToClient, { timeoutMs: 60000 });

      // Create a pending permission
      const promise = handler.canUseTool("Bash", { command: "ls" }, {
        toolUseID: "req-123",
        sessionId: "session-1",
        signal,
      } as any);

      // Pause and resume
      const snapshots = handler.pausePending();
      handler.resumePending(snapshots);

      // Deny the permission
      handler.resolvePermission("req-123", false);

      // Promise should resolve with deny
      const result = await promise;
      expect(result.behavior).toBe("deny");
      expect(result.message).toBe("Denied by user");
    });
  });
});
