import { describe, expect, it } from "bun:test";
import { getToolDefinition } from "./tool-registry";

describe("ToolRegistry", () => {
  it("1. getToolDefinition('Read') returns object with name 'Read', icon '📖', minimal true", () => {
    const def = getToolDefinition("Read");
    expect(def).toBeDefined();
    expect(def?.name).toBe("Read");
    expect(def?.icon).toBe("📖");
    expect(def?.minimal).toBe(true);
  });

  it("2. getToolDefinition('Bash') returns object with name 'Bash', icon '⚙️', minimal true", () => {
    const def = getToolDefinition("Bash");
    expect(def).toBeDefined();
    expect(def?.name).toBe("Bash");
    expect(def?.icon).toBe("⚙️");
    expect(def?.minimal).toBe(true);
  });

  it("3. getToolDefinition('Edit') returns object with name 'Edit', icon '✏️', minimal true", () => {
    const def = getToolDefinition("Edit");
    expect(def).toBeDefined();
    expect(def?.name).toBe("Edit");
    expect(def?.icon).toBe("✏️");
    expect(def?.minimal).toBe(true);
  });

  it("4. getToolDefinition('UnknownTool') returns undefined", () => {
    const def = getToolDefinition("UnknownTool");
    expect(def).toBeUndefined();
  });

  it("5. Bash title with description input returns the description string", () => {
    const def = getToolDefinition("Bash");
    expect(def).toBeDefined();
    const title = def?.title({ description: "Install deps" });
    expect(title).toBe("Install deps");
  });

  it("6. Bash title with only command input returns the command string", () => {
    const def = getToolDefinition("Bash");
    expect(def).toBeDefined();
    const title = def?.title({ command: "npm install" });
    expect(title).toBe("npm install");
  });

  it("should prefer description over command for Bash", () => {
    const def = getToolDefinition("Bash");
    expect(def).toBeDefined();
    const title = def?.title({ description: "Install deps", command: "npm install" });
    expect(title).toBe("Install deps");
  });

  it("should extract filename from Read file_path", () => {
    const def = getToolDefinition("Read");
    expect(def).toBeDefined();
    const title = def?.title({ file_path: "/Users/test/file.txt" });
    expect(title).toBe("file.txt");
  });

  it("should extract filename from Edit file_path", () => {
    const def = getToolDefinition("Edit");
    expect(def).toBeDefined();
    const title = def?.title({ file_path: "/src/components/App.tsx" });
    expect(title).toBe("App.tsx");
  });

  it("should extract filename from Write file_path", () => {
    const def = getToolDefinition("Write");
    expect(def).toBeDefined();
    const title = def?.title({ file_path: "/tmp/output.json" });
    expect(title).toBe("output.json");
  });

  it("should use pattern for Glob title", () => {
    const def = getToolDefinition("Glob");
    expect(def).toBeDefined();
    const title = def?.title({ pattern: "**/*.ts" });
    expect(title).toBe("**/*.ts");
  });

  it("should use pattern for Grep title", () => {
    const def = getToolDefinition("Grep");
    expect(def).toBeDefined();
    const title = def?.title({ pattern: "console.log" });
    expect(title).toBe("Search: console.log");
  });
});
