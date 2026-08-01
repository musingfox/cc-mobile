/**
 * protocol-tmux-control.test.ts — tmux_create / tmux_teardown are members of the
 * single ClientMessage union (ADR-001), not a hand-rolled pre-parse branch.
 *
 * Malformed messages now fail safeParse, which ws.ts turns into the shared
 * `invalid_message` error rather than the retired `invalid_tmux_create` code.
 */

import { describe, expect, it } from "bun:test";
import { ClientMessage } from "../protocol";

describe("ClientMessage — tmux_create", () => {
  it("accepts a well-formed tmux_create and narrows its type", () => {
    const result = ClientMessage.safeParse({
      type: "tmux_create",
      claudeUuid: "u1",
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe("tmux_create");
    if (result.data.type !== "tmux_create") return;
    expect(result.data.claudeUuid).toBe("u1");
    expect(result.data.cwd).toBe("/tmp");
  });

  it("rejects an empty claudeUuid", () => {
    const result = ClientMessage.safeParse({
      type: "tmux_create",
      claudeUuid: "",
      cwd: "/tmp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty cwd", () => {
    const result = ClientMessage.safeParse({
      type: "tmux_create",
      claudeUuid: "u1",
      cwd: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing cwd", () => {
    const result = ClientMessage.safeParse({ type: "tmux_create", claudeUuid: "u1" });
    expect(result.success).toBe(false);
  });
});

describe("ClientMessage — tmux_teardown", () => {
  it("accepts a well-formed tmux_teardown and narrows its type", () => {
    const result = ClientMessage.safeParse({ type: "tmux_teardown", claudeUuid: "u1" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe("tmux_teardown");
    if (result.data.type !== "tmux_teardown") return;
    expect(result.data.claudeUuid).toBe("u1");
  });

  it("rejects a missing claudeUuid", () => {
    const result = ClientMessage.safeParse({ type: "tmux_teardown" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty claudeUuid", () => {
    const result = ClientMessage.safeParse({ type: "tmux_teardown", claudeUuid: "" });
    expect(result.success).toBe(false);
  });
});
