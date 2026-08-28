/**
 * protocol-terminal-control.test.ts — terminal_create / terminal_teardown are members of the
 * single ClientMessage union (ADR-001), not a hand-rolled pre-parse branch.
 *
 * Malformed messages now fail safeParse, which ws.ts turns into the shared
 * `invalid_message` error rather than the retired `invalid_terminal_create` code.
 */

import { describe, expect, it } from "bun:test";
import { ClientMessage } from "../protocol";

describe("ClientMessage — terminal_create", () => {
  it("accepts a well-formed terminal_create and narrows its type", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe("terminal_create");
    if (result.data.type !== "terminal_create") return;
    expect(result.data.claudeUuid).toBe("u1");
    expect(result.data.cwd).toBe("/tmp");
  });

  it("rejects an empty claudeUuid", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "",
      cwd: "/tmp",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty cwd", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing cwd", () => {
    const result = ClientMessage.safeParse({ type: "terminal_create", claudeUuid: "u1" });
    expect(result.success).toBe(false);
  });

  it("accepts a supported agentKind and carries it through", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
      agentKind: "omp",
    });
    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== "terminal_create") return;
    expect(result.data.agentKind).toBe("omp");
  });

  it("rejects a kind cc-mobile does not launch, so agent.start is never reached", () => {
    // The whitelist lives in the gate rather than in the handler: `kind` is what
    // herdr turns into an exec'd argv, so an unsupported value must not get as
    // far as code that could pass it on (#31).
    for (const agentKind of ["codex", "", "claude; rm -rf /"]) {
      expect(
        ClientMessage.safeParse({
          type: "terminal_create",
          claudeUuid: "u1",
          cwd: "/tmp",
          agentKind,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts an absent agentKind — every bundle cached before #31 sends none", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== "terminal_create") return;
    expect(result.data.agentKind).toBeUndefined();
  });

  it("accepts a non-empty profile id", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
      profileId: "p1",
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== "terminal_create") return;
    expect(result.data.profileId).toBe("p1");
  });

  it("rejects an empty profile id", () => {
    expect(
      ClientMessage.safeParse({
        type: "terminal_create",
        claudeUuid: "u1",
        cwd: "/tmp",
        profileId: "",
      }).success,
    ).toBe(false);
  });

  it("drops client-supplied argv and command fields", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
      profileId: "p1",
      args: ["--auto-approve"],
      command: "omp",
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== "terminal_create") return;
    expect(result.data.profileId).toBe("p1");
    expect(Object.hasOwn(result.data, "args")).toBe(false);
    expect(Object.hasOwn(result.data, "command")).toBe(false);
  });

  it("keeps profile id optional for cached bundles", () => {
    const result = ClientMessage.safeParse({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
    });

    expect(result.success).toBe(true);
    if (!result.success || result.data.type !== "terminal_create") return;
    expect(result.data.profileId).toBeUndefined();
  });
});

describe("ClientMessage — terminal_teardown", () => {
  it("accepts a well-formed terminal_teardown and narrows its type", () => {
    const result = ClientMessage.safeParse({ type: "terminal_teardown", claudeUuid: "u1" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe("terminal_teardown");
    if (result.data.type !== "terminal_teardown") return;
    expect(result.data.claudeUuid).toBe("u1");
  });

  it("accepts the pane-keyed sessionId as well as the legacy claudeUuid", () => {
    // Both names travel during the re-key window (Decision H5): a cached bundle
    // still sends claudeUuid, a current one sends the listed sessionId.
    expect(
      ClientMessage.safeParse({ type: "terminal_teardown", sessionId: "w3V:p1" }).success,
    ).toBe(true);
    // Neither key is a malformed request the handler answers with invalid_message
    // rather than a teardown of nothing.
    expect(ClientMessage.safeParse({ type: "terminal_teardown" }).success).toBe(true);
  });

  it("rejects an empty key under either name", () => {
    expect(ClientMessage.safeParse({ type: "terminal_teardown", claudeUuid: "" }).success).toBe(
      false,
    );
    expect(ClientMessage.safeParse({ type: "terminal_teardown", sessionId: "" }).success).toBe(
      false,
    );
  });
});
