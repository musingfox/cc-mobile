import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { handleCompactBoundaryChunk } from "../services/ws-service";
import { type Message, useAppStore } from "../stores/app-store";

describe("handleCompactBoundaryChunk", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    // Reset store sessions to avoid bleeding into other test files.
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("matching chunk appends a compact_boundary message with token figures", () => {
    useAppStore.getState().addSession("s1", "/tmp");
    const chunk = {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto", pre_tokens: 24000, post_tokens: 8000 },
      session_id: "sdk-1",
      uuid: "u1",
    };

    const matched = handleCompactBoundaryChunk("s1", chunk, useAppStore.getState(), () => 7777);

    expect(matched).toBe(true);
    const session = useAppStore.getState().sessions.get("s1");
    expect(session?.messages.length).toBe(1);
    const msg = session?.messages[0] as Message;
    expect(msg.kind).toBe("compact_boundary");
    expect(msg.compactMetadata?.preTokens).toBe(24000);
    expect(msg.compactMetadata?.postTokens).toBe(8000);
    expect(msg.compactMetadata?.trigger).toBe("auto");
    expect(msg.timestamp).toBe(7777);
    expect(msg.id).toBe("compact-sdk-1-u1");
  });

  test("chunk with missing compact_metadata logs warn and returns false", () => {
    useAppStore.getState().addSession("s2", "/tmp");
    const chunk = {
      type: "system",
      subtype: "compact_boundary",
      session_id: "sdk-2",
      uuid: "u2",
    };

    const matched = handleCompactBoundaryChunk("s2", chunk, useAppStore.getState());

    expect(matched).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    const session = useAppStore.getState().sessions.get("s2");
    expect(session?.messages.length).toBe(0);
  });

  test("session not present in store: returns false, no-op", () => {
    const chunk = {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "manual", pre_tokens: 1000 },
      session_id: "sdk-3",
      uuid: "u3",
    };

    const matched = handleCompactBoundaryChunk("missing", chunk, useAppStore.getState());

    expect(matched).toBe(false);
    // No messages anywhere.
    expect(useAppStore.getState().sessions.size).toBe(0);
  });

  test("non-matching chunk type returns false, no warn", () => {
    useAppStore.getState().addSession("s4", "/tmp");
    const matched = handleCompactBoundaryChunk(
      "s4",
      { type: "system", subtype: "task_started" },
      useAppStore.getState(),
    );
    expect(matched).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().sessions.get("s4")?.messages.length).toBe(0);
  });

  test("chunk without pre_tokens still inserts divider (no token figures)", () => {
    useAppStore.getState().addSession("s5", "/tmp");
    const chunk = {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { trigger: "auto" },
      session_id: "sdk-5",
      uuid: "u5",
    };

    const matched = handleCompactBoundaryChunk("s5", chunk, useAppStore.getState());

    expect(matched).toBe(true);
    const msg = useAppStore.getState().sessions.get("s5")?.messages[0] as Message;
    expect(msg.kind).toBe("compact_boundary");
    expect(msg.compactMetadata?.preTokens).toBeUndefined();
    expect(msg.compactMetadata?.postTokens).toBeUndefined();
    expect(msg.compactMetadata?.trigger).toBe("auto");
  });
});
