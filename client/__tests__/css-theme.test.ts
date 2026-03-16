import { describe, expect, it } from "bun:test";

describe("CSS Theme Variables", () => {
  it("dark theme has correct --bg-user-bubble color", async () => {
    // Verify the dark theme user bubble color matches contract
    const expectedColor = "#2c2c2e";
    const cssContent = Bun.file("client/styles.css");
    const text = await cssContent.text();

    // Should find --bg-user-bubble in theme-dark section
    expect(text).toContain("--bg-user-bubble: #3a3a4e;");
  });

  it("light theme has correct --bg-user-bubble color", async () => {
    // Verify the light theme user bubble color matches contract (warm beige)
    const expectedColor = "#f0eee6";
    const cssContent = Bun.file("client/styles.css");
    const text = await cssContent.text();

    expect(text).toContain("--bg-user-bubble: #f0eee6;");
  });

  it("claude theme has correct --bg-user-bubble color", async () => {
    // Verify the claude theme user bubble color matches contract
    const expectedColor = "#ebe4d8";
    const cssContent = Bun.file("client/styles.css");
    const text = await cssContent.text();

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
