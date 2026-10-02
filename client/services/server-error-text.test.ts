import { describe, expect, test } from "bun:test";
import { describeServerError } from "./server-error-text";

describe("describeServerError", () => {
  test("herdr's busy-pane refusal reads as a create that can be retried", () => {
    const text = describeServerError(
      "terminal_error",
      "agent_pane_busy: agent target pane wJ4:p1 is not an available shell",
      true,
    );

    expect(text).toBe("Couldn't start the session: the new terminal wasn't ready yet. Try again.");
  });

  test("no herdr code, pane id or raw wording reaches the sentence", () => {
    for (const message of [
      "agent_pane_busy: agent target pane wJ4:p1 is not an available shell",
      "agent_name_taken: agent name ccm-1 is already used; candidates: terminal_id=t1",
      "herdr pane wJ4:p1 did not reach interactive_ready within 30000ms",
      "boom",
    ]) {
      const text = describeServerError("terminal_error", message, true);
      expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(text).not.toContain("wJ4");
      expect(text.startsWith("Couldn't start the session")).toBe(true);
    }
  });

  test("an unreachable herdr socket is named as such", () => {
    expect(
      describeServerError(
        "terminal_error",
        "herdr workspace.create: socket error: connect ENOENT /x/herdr.sock",
        true,
      ),
    ).toBe("cc-mobile can't reach herdr on the host.");
  });

  test("a terminal error with no create pending is a failed close", () => {
    expect(describeServerError("terminal_error", "herdr said no", false)).toBe(
      "Couldn't close the session.",
    );
  });

  test("the schema gate's wording is replaced", () => {
    expect(describeServerError("invalid_message", "Invalid message format", false)).toBe(
      "The server didn't accept that request. Reload the app and try again.",
    );
  });

  test("a message already written for a person passes through", () => {
    expect(
      describeServerError("path_not_allowed", "Project path is not in the allowed roots", true),
    ).toBe("Project path is not in the allowed roots");
    expect(describeServerError("unknown_profile", "Unknown agent profile: p1", true)).toBe(
      "Unknown agent profile: p1",
    );
  });
});
