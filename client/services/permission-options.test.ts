import { describe, expect, it } from "bun:test";
import { getPermissionOptions } from "./permission-options";

describe("getPermissionOptions", () => {
  it("1. Edit tool returns 3 options with correct labels", () => {
    const options = getPermissionOptions("Edit", { file_path: "foo.ts" });

    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({
      id: "yes",
      label: "Yes",
      color: "green",
      action: "approve",
    });
    expect(options[1]).toEqual({
      id: "all-edits",
      label: "Allow all edits this session",
      color: "blue",
      action: "approve_session",
    });
    expect(options[2]).toEqual({
      id: "no",
      label: "No",
      color: "red",
      action: "deny",
    });
  });

  it("2. Bash tool returns option with command in label", () => {
    const options = getPermissionOptions("Bash", { command: "ls -la" });

    expect(options).toHaveLength(3);
    expect(options[1]).toEqual({
      id: "allow-cmd",
      label: "Allow `ls -la` this session",
      color: "blue",
      action: "approve_session",
    });
  });

  it("Bash tool truncates long commands", () => {
    const longCommand = "echo 'this is a very long command that should be truncated properly'";
    const options = getPermissionOptions("Bash", { command: longCommand });

    expect(options[1].label).toContain("...");
    expect(options[1].label.length).toBeLessThan(100);
  });

  it("3. Generic tool returns allow-tool option", () => {
    const options = getPermissionOptions("WebFetch", { url: "https://example.com" });

    expect(options).toHaveLength(3);
    expect(options[1]).toEqual({
      id: "allow-tool",
      label: "Allow WebFetch this session",
      color: "blue",
      action: "approve_session",
    });
  });

  it("All tools have consistent structure", () => {
    const tools = ["Edit", "Bash", "Read", "Write", "WebFetch"];

    for (const tool of tools) {
      const options = getPermissionOptions(tool, {});

      expect(options).toHaveLength(3);
      expect(options[0].color).toBe("green");
      expect(options[0].action).toBe("approve");
      expect(options[1].color).toBe("blue");
      expect(options[1].action).toBe("approve_session");
      expect(options[2].color).toBe("red");
      expect(options[2].action).toBe("deny");
    }
  });
});
