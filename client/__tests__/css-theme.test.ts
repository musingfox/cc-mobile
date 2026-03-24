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
    const text = await Bun.file("client/styles.css").text();
    expect(text).toContain(".message.user .message-content");
    // User bubble uses gradient with bg-user-bubble
    expect(text).toContain("var(--bg-user-bubble)");
  });

  it("assistant messages use glass background", async () => {
    const text = await Bun.file("client/styles.css").text();
    expect(text).toContain(".message.assistant .message-content");
    expect(text).toContain("var(--glass-bg-heavy)");
  });
});
