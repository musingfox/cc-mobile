/**
 * claude-settings.test.ts — ClaudeSettingsHookInjection contract.
 *
 * The four SettingsInjection cases (T1/T2/T2b/T3) moved verbatim from the
 * retired terminal adapter's test file when the builder was extracted to a
 * backend-neutral module (#25). The hook shape must not change across that move.
 */

import { describe, expect, it } from "bun:test";
import { buildClaudeSettings } from "./claude-settings";

describe("SettingsInjection (pure)", () => {
  it("T1: wires Stop hook with empty matcher and CC_MOBILE_RESPONSE_URL + bun + quoted path", () => {
    const settings = buildClaudeSettings({
      responseUrl: "http://127.0.0.1:3001/cc/api/pty-response",
      stopHookPath: "/r/server/pty-stop-hook.ts",
    });
    expect(settings.hooks.Stop[0].matcher).toBe("");
    const cmd = settings.hooks.Stop[0].hooks[0].command;
    expect(cmd).toBe(
      "CC_MOBILE_RESPONSE_URL='http://127.0.0.1:3001/cc/api/pty-response' bun '/r/server/pty-stop-hook.ts'",
    );
  });

  it("T2: wires PreToolUse (matcher Bash|Write|Edit|NotebookEdit) when permissionUrl + permissionHookPath given; Stop unchanged", () => {
    const settings = buildClaudeSettings({
      responseUrl: "http://127.0.0.1:3001/cc/api/pty-response",
      stopHookPath: "/r/server/pty-stop-hook.ts",
      permissionUrl: "http://127.0.0.1:3001/cc/api/pty-permission",
      permissionHookPath: "/r/server/pty-permission-hook.ts",
    });
    expect(settings.hooks.PreToolUse).toBeDefined();
    expect(settings.hooks.PreToolUse![0].matcher).toBe("Bash|Write|Edit|NotebookEdit");
    expect(settings.hooks.PreToolUse![0].hooks[0].type).toBe("command");
    expect(settings.hooks.PreToolUse![0].hooks[0].command).toBe(
      "CC_MOBILE_PERMISSION_URL='http://127.0.0.1:3001/cc/api/pty-permission' bun '/r/server/pty-permission-hook.ts'",
    );
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      "CC_MOBILE_RESPONSE_URL='http://127.0.0.1:3001/cc/api/pty-response' bun '/r/server/pty-stop-hook.ts'",
    );
  });

  it("T2b: omitting permissionUrl/permissionHookPath leaves PreToolUse undefined; Stop still present", () => {
    const settings = buildClaudeSettings({
      responseUrl: "http://127.0.0.1:3001/cc/api/pty-response",
      stopHookPath: "/r/server/pty-stop-hook.ts",
    });
    expect(settings.hooks.PreToolUse).toBeUndefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      "CC_MOBILE_RESPONSE_URL='http://127.0.0.1:3001/cc/api/pty-response' bun '/r/server/pty-stop-hook.ts'",
    );
  });

  it("T3: throws when responseUrl is empty", () => {
    expect(() =>
      buildClaudeSettings({
        responseUrl: "",
        stopHookPath: "/r/server/pty-stop-hook.ts",
      }),
    ).toThrow();
  });

  it("T3b: throws when responseUrl is all whitespace", () => {
    expect(() =>
      buildClaudeSettings({
        responseUrl: "   ",
        stopHookPath: "/r/server/pty-stop-hook.ts",
      }),
    ).toThrow("responseUrl is required and must be non-empty");
  });

  it("omitting permissionUrl while giving permissionHookPath leaves PreToolUse undefined", () => {
    const settings = buildClaudeSettings({
      responseUrl: "http://127.0.0.1:3001/cc/api/pty-response",
      stopHookPath: "/r/server/pty-stop-hook.ts",
      permissionHookPath: "/r/server/pty-permission-hook.ts",
    });
    expect(settings.hooks.PreToolUse).toBeUndefined();
  });
});
