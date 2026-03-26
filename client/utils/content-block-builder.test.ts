import { describe, expect, test } from "bun:test";
import { buildContentBlocks } from "./content-block-builder";

describe("content-block-builder", () => {
  test("C3: text only returns string", () => {
    const result = buildContentBlocks("hello", [], []);
    expect(result).toBe("hello");
  });

  test("C3: text with image returns content blocks", () => {
    const result = buildContentBlocks("describe", [{ base64: "abc", mediaType: "image/jpeg" }], []);

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "text",
      text: "describe",
    });
    expect(result[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "abc",
      },
    });
  });

  test("C3: text with file path returns string with file reference", () => {
    const result = buildContentBlocks("read", [], ["/path/doc.pdf"]);

    expect(typeof result).toBe("string");
    expect(result).toBe("read\n[Attached file: /path/doc.pdf]");
  });

  test("C3: text with both image and file", () => {
    const result = buildContentBlocks(
      "look",
      [{ base64: "xyz", mediaType: "image/png" }],
      ["/path/f.pdf"],
    );

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: "text",
      text: "look\n[Attached file: /path/f.pdf]",
    });
    expect(result[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "xyz",
      },
    });
  });

  test("no text, only image", () => {
    const result = buildContentBlocks("", [{ base64: "img", mediaType: "image/webp" }], []);

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/webp",
        data: "img",
      },
    });
  });

  test("no text, only file", () => {
    const result = buildContentBlocks("", [], ["/file.txt"]);

    expect(typeof result).toBe("string");
    expect(result).toBe("[Attached file: /file.txt]");
  });

  test("multiple images", () => {
    const result = buildContentBlocks(
      "compare",
      [
        { base64: "img1", mediaType: "image/jpeg" },
        { base64: "img2", mediaType: "image/png" },
      ],
      [],
    );

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("text");
    expect(result[1].type).toBe("image");
    expect(result[2].type).toBe("image");
  });

  test("multiple files", () => {
    const result = buildContentBlocks("process", [], ["/file1.pdf", "/file2.docx"]);

    expect(typeof result).toBe("string");
    expect(result).toBe("process\n[Attached file: /file1.pdf]\n[Attached file: /file2.docx]");
  });
});
