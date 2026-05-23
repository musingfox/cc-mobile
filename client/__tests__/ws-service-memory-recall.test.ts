import { describe, expect, test } from "bun:test";
import { handleMemoryRecallChunk } from "../services/ws-service";
import type { ActiveTool } from "../stores/app-store";

function makeStore() {
  const calls: Array<{ sessionId: string; toolUseId: string; tool: ActiveTool }> = [];
  return {
    calls,
    addActiveTool(sessionId: string, toolUseId: string, tool: ActiveTool) {
      calls.push({ sessionId, toolUseId, tool });
    },
  };
}

describe("handleMemoryRecallChunk", () => {
  test("matching chunk with two memories → one entry at memory-<uuid>", () => {
    const store = makeStore();
    const chunk = {
      type: "system",
      subtype: "memory_recall",
      uuid: "mem-1",
      mode: "select",
      memories: [{ path: "/Users/x/notes.md" }, { path: "/Users/x/log.md" }],
    };

    const matched = handleMemoryRecallChunk("sess-A", chunk, store, () => 1234);

    expect(matched).toBe(true);
    expect(store.calls.length).toBe(1);
    const call = store.calls[0];
    expect(call.sessionId).toBe("sess-A");
    expect(call.toolUseId).toBe("memory-mem-1");
    expect(call.tool.toolName).toBe("Memory");
    expect(call.tool.startedAt).toBe(1234);
    const input = call.tool.input as { paths: string[]; count: number; mode?: string };
    expect(input.count).toBe(2);
    expect(input.paths).toEqual(["/Users/x/notes.md", "/Users/x/log.md"]);
    expect(input.mode).toBe("select");
  });

  test("non-matching chunk → store untouched, returns false", () => {
    const store = makeStore();
    const matched = handleMemoryRecallChunk(
      "sess-A",
      { type: "system", subtype: "task_started" },
      store,
    );
    expect(matched).toBe(false);
    expect(store.calls.length).toBe(0);
  });

  test("synthesis mode with <synthesis:DIR> path is preserved verbatim", () => {
    const store = makeStore();
    const chunk = {
      type: "system",
      subtype: "memory_recall",
      uuid: "mem-2",
      mode: "synthesize",
      memories: [{ path: "<synthesis:projects/foo>" }],
    };
    handleMemoryRecallChunk("sess-A", chunk, store);

    expect(store.calls.length).toBe(1);
    const input = store.calls[0].tool.input as {
      paths: string[];
      count: number;
      mode?: string;
    };
    expect(input.mode).toBe("synthesize");
    expect(input.paths[0]).toBe("<synthesis:projects/foo>");
    expect(input.count).toBe(1);
  });
});
