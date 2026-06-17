import { describe, expect, test } from "bun:test";
import { buildPtyPrompt } from "./pty-prompt-builder";

describe("buildPtyPrompt", () => {
  test("EX1: plain text, no attachments -> byte-identical to input", () => {
    const text = "just some text\nwith a line";
    expect(buildPtyPrompt(text, [], [])).toBe(text);
  });

  test("EX2: empty text + attachments -> non-empty, contains each path, no leading newline", () => {
    const imgs = ["/c/a.png", "/c/b.jpg"];
    const files = ["/c/doc.pdf"];
    const out = buildPtyPrompt("", imgs, files);
    expect(out.length).toBeGreaterThan(0);
    for (const p of [...imgs, ...files]) {
      expect(out).toContain(p);
    }
    // no leading whitespace/newline
    expect(out.trimStart()).toBe(out);
  });

  test("EX3: text + 2 images + 1 file -> contains text and every absolute path, text before frame", () => {
    const text = "please review";
    const imgs = ["/c/one.png", "/c/two.png"];
    const files = ["/c/three.pdf"];
    const out = buildPtyPrompt(text, imgs, files);
    expect(out).toContain(text);
    for (const p of [...imgs, ...files]) {
      expect(out).toContain(p);
    }
    // text appears before any of the attachment paths (before the frame)
    const textIdx = out.indexOf(text);
    for (const p of [...imgs, ...files]) {
      expect(textIdx).toBeLessThan(out.indexOf(p));
    }
  });

  test("EX4: paths with spaces are emitted verbatim, unquoted, line by line", () => {
    const out = buildPtyPrompt("", ["/c/my photos/a b.png"], []);
    expect(out).toContain("/c/my photos/a b.png");
    // unquoted: the bare path must not be wrapped in quotes
    expect(out).not.toContain('"/c/my photos/a b.png"');
    expect(out).not.toContain("'/c/my photos/a b.png'");
  });

  test("EX5: exact format snapshot (pin)", () => {
    const out = buildPtyPrompt("hi", ["/c/a.png"], ["/c/d.pdf"]);
    const expected = [
      "hi",
      "",
      "Please read these attached files using the Read tool:",
      "- /c/a.png",
      "- /c/d.pdf",
    ].join("\n");
    expect(out).toBe(expected);
    // no trailing newline
    expect(out.endsWith("\n")).toBe(false);
  });
});
