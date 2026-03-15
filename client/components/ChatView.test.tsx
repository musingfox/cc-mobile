import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("CHATVIEW_EMPTY_STATE", () => {
  test("T4: ChatView renders welcome message when messages=[]", () => {
    const chatViewPath = join(import.meta.dir, "ChatView.tsx");
    const content = readFileSync(chatViewPath, "utf-8");

    expect(content).toContain("chat-empty-welcome");
    expect(content).toContain("chat-empty-resume");

    // Verify the old project picker UI is removed
    expect(content).not.toContain("selectedCwd");
    expect(content).not.toContain("customPath");
    expect(content).not.toContain("loadProjects");
  });

  test("T5: ChatView does NOT have onNewSession prop", () => {
    const chatViewPath = join(import.meta.dir, "ChatView.tsx");
    const content = readFileSync(chatViewPath, "utf-8");

    const propsTypeMatch = content.match(/type ChatViewProps = \{[^}]+\}/s);
    expect(propsTypeMatch).toBeTruthy();

    const propsType = propsTypeMatch?.[0] || "";
    expect(propsType).not.toContain("onNewSession");
  });
});
