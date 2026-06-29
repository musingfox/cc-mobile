import { describe, expect, test } from "bun:test";
import { handlePermissionDeniedChunk } from "../services/ws-service";
import type { Message } from "../stores/app-store";

function makeStore() {
  const added: Array<{ sessionId: string; message: Message }> = [];
  const removed: Array<{ sessionId: string; toolUseId: string }> = [];
  return {
    added,
    removed,
    addMessage(sessionId: string, message: Message) {
      added.push({ sessionId, message });
    },
    removeActiveTool(sessionId: string, toolUseId: string) {
      removed.push({ sessionId, toolUseId });
    },
  };
}

describe("handlePermissionDeniedChunk", () => {
  test("full chunk: appends permission_denied marker and removes ActiveTool", () => {
    const store = makeStore();
    const chunk = {
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      tool_use_id: "tu1",
      message: "Bash is not allowed in current mode",
      session_id: "s1",
      uuid: "u1",
    };

    const matched = handlePermissionDeniedChunk("s1", chunk, store, () => 1000);

    expect(matched).toBe(true);
    expect(store.added.length).toBe(1);
    const msg = store.added[0].message;
    expect(msg.kind).toBe("permission_denied");
    expect(msg.role).toBe("assistant");
    expect(msg.toolName).toBe("Bash");
    expect(msg.content).toBe("Bash is not allowed in current mode");
    expect(msg.id.startsWith("deny-")).toBe(true);
    expect(msg.timestamp).toBe(1000);

    expect(store.removed.length).toBe(1);
    expect(store.removed[0]).toEqual({ sessionId: "s1", toolUseId: "tu1" });
  });

  test("missing tool_use_id: marker appended, removeActiveTool NOT called", () => {
    const store = makeStore();
    const chunk = {
      type: "system",
      subtype: "permission_denied",
      tool_name: "Read",
      message: "Read denied",
      session_id: "s1",
      uuid: "u2",
    };

    const matched = handlePermissionDeniedChunk("s1", chunk, store);
    expect(matched).toBe(true);
    expect(store.added.length).toBe(1);
    expect(store.added[0].message.toolName).toBe("Read");
    expect(store.removed.length).toBe(0);
  });

  test("missing tool_name: marker uses 'unknown tool'", () => {
    const store = makeStore();
    const chunk = {
      type: "system",
      subtype: "permission_denied",
      message: "Tool denied by classifier",
      session_id: "s1",
      uuid: "u3",
    };

    const matched = handlePermissionDeniedChunk("s1", chunk, store);
    expect(matched).toBe(true);
    expect(store.added[0].message.toolName).toBe("unknown tool");
  });

  test("non-matching chunk: returns false, no store calls", () => {
    const store = makeStore();
    const matched = handlePermissionDeniedChunk(
      "s1",
      { type: "system", subtype: "task_started" },
      store,
    );
    expect(matched).toBe(false);
    expect(store.added.length).toBe(0);
    expect(store.removed.length).toBe(0);
  });
});
