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
});
