import { describe, expect, test } from "bun:test";
import type { ContentBlock } from "../protocol";
import { SessionManager } from "../session-manager";

/**
 * C3 — the append buffer's caps and atomicity.
 *
 * Before #25 these cases observed the buffer by draining `sendMessage` and
 * reading the prompt the SDK mock captured. That driver is gone (the buffer is
 * a documented no-op now, see the TODO(#25-followup) on `appendUserMessage`),
 * so the buffer itself is read directly. What is pinned is unchanged: the 50
 * entry / 1MB caps, and that a rejected append leaves the buffer untouched.
 */
function readBuffer(mgr: SessionManager, sessionId: string): ContentBlock[] {
  const sessions = (
    mgr as unknown as {
      sessions: Map<string, { pendingAppendBlocks: ContentBlock[] }>;
    }
  ).sessions;
  const config = sessions.get(sessionId);
  if (!config) throw new Error(`no session ${sessionId}`);
  return config.pendingAppendBlocks;
}

describe("SessionManager.appendUserMessage", () => {
  test("appends accumulate in order across calls", async () => {
    const mgr = new SessionManager();
    await mgr.createSession("ws-1", "/cwd");

    mgr.appendUserMessage("ws-1", "first note");
    mgr.appendUserMessage("ws-1", "second note");

    expect(readBuffer(mgr, "ws-1")).toEqual([
      { type: "text", text: "first note" },
      { type: "text", text: "second note" },
    ]);
  });

  test("appendUserMessage on missing session throws not-found", () => {
    const mgr = new SessionManager();
    expect(() => mgr.appendUserMessage("nope", "hi")).toThrow("Session nope not found");
  });

  test("51st append exceeds count cap, throws atomically", async () => {
    const mgr = new SessionManager();
    await mgr.createSession("ws-2", "/cwd");

    for (let i = 0; i < 50; i++) {
      mgr.appendUserMessage("ws-2", "x");
    }
    expect(() => mgr.appendUserMessage("ws-2", "x")).toThrow("append_buffer_full");

    // After the rejection the buffer should still hold exactly 50 entries.
    expect(readBuffer(mgr, "ws-2")).toHaveLength(50);
  });

  test("byte cap rejects payload that would exceed 1MB", async () => {
    const mgr = new SessionManager();
    await mgr.createSession("ws-3", "/cwd");

    // Push a ~700KB text block, then try to push another ~400KB block.
    mgr.appendUserMessage("ws-3", "a".repeat(700_000));
    expect(() => mgr.appendUserMessage("ws-3", "b".repeat(400_000))).toThrow("append_buffer_full");
    expect(readBuffer(mgr, "ws-3")).toHaveLength(1);

    // Image data also counts: try an image with > 1MB base64 data on a fresh session.
    await mgr.createSession("ws-4", "/cwd");
    expect(() =>
      mgr.appendUserMessage("ws-4", [
        {
          type: "text",
          text: "small",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "x".repeat(1_048_577),
          },
        },
      ]),
    ).toThrow("append_buffer_full");
    expect(readBuffer(mgr, "ws-4")).toHaveLength(0);
  });

  test("ContentBlock[] append keeps text and image blocks in order", async () => {
    const mgr = new SessionManager();
    await mgr.createSession("ws-5", "/cwd");

    mgr.appendUserMessage("ws-5", [
      { type: "text", text: "see attachment" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
    ]);

    expect(readBuffer(mgr, "ws-5")).toEqual([
      { type: "text", text: "see attachment" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "abc" },
      },
    ]);
  });
});
