import { describe, expect, it } from "bun:test";

describe("CSS Theme Variables", () => {
  it("dark theme has correct --bg-user-bubble color", async () => {
    const text = await Bun.file("client/styles.css").text();
    expect(text).toContain("--bg-user-bubble: #3a3a4e;");
  });

  it("light theme has correct --bg-user-bubble color", async () => {
    const text = await Bun.file("client/styles.css").text();
    expect(text).toContain("--bg-user-bubble: #f0eee6;");
  });

  it("claude theme has correct --bg-user-bubble color", async () => {
    const text = await Bun.file("client/styles.css").text();
    expect(text).toContain("--bg-user-bubble: #ebe4d8;");
  });

  it("user messages use --bg-user-bubble variable", async () => {
    const cssContent = Bun.file("client/styles.css");
    const text = await cssContent.text();

    // Should find user message content using the new variable
    expect(text).toContain(".message.user .message-content");
    expect(text).toContain("background: var(--bg-user-bubble);");
  });

  it("assistant messages use secondary background", async () => {
    const cssContent = Bun.file("client/styles.css");
    const text = await cssContent.text();

    // Should find assistant message content with subtle background
    expect(text).toContain(".message.assistant .message-content");
    expect(text).toContain("background: var(--bg-secondary);");
  });
});
