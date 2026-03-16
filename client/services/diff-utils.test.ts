import { describe, expect, it } from "bun:test";
import { computeDiff } from "./diff-utils";

describe("computeDiff", () => {
  it("1. single line change produces correct add/remove with highlights", () => {
    const result = computeDiff("hello world", "hello earth");

    expect(result.length).toBe(2);
    expect(result[0].type).toBe("remove");
    expect(result[0].content).toBe("hello world");
    expect(result[0].oldLineNum).toBe(1);
    expect(result[0].highlights).toBeDefined();
    expect((result[0].highlights ?? []).length).toBeGreaterThan(0);

    expect(result[1].type).toBe("add");
    expect(result[1].content).toBe("hello earth");
    expect(result[1].newLineNum).toBe(1);
    expect(result[1].highlights).toBeDefined();
    expect((result[1].highlights ?? []).length).toBeGreaterThan(0);
  });

  it("2. multi-line with context produces context + add + remove lines", () => {
    const result = computeDiff("line1\nline2\nline3", "line1\nmodified\nline3");

    expect(result.length).toBe(4);

    // Context line1
    expect(result[0]).toEqual({
      type: "context",
      content: "line1",
      oldLineNum: 1,
      newLineNum: 1,
    });

    // Remove line2
    expect(result[1]).toEqual({
      type: "remove",
      content: "line2",
      oldLineNum: 2,
      highlights: expect.any(Array),
    });

    // Add modified
    expect(result[2]).toEqual({
      type: "add",
      content: "modified",
      newLineNum: 2,
      highlights: expect.any(Array),
    });

    // Context line3
    expect(result[3]).toEqual({
      type: "context",
      content: "line3",
      oldLineNum: 3,
      newLineNum: 3,
    });
  });

  it("3. empty old string (new file) produces all add lines", () => {
    const result = computeDiff("", "line1\nline2\nline3");

    expect(result.length).toBe(3);
    expect(result.every((line) => line.type === "add")).toBe(true);

    expect(result[0]).toEqual({
      type: "add",
      content: "line1",
      newLineNum: 1,
    });

    expect(result[1]).toEqual({
      type: "add",
      content: "line2",
      newLineNum: 2,
    });

    expect(result[2]).toEqual({
      type: "add",
      content: "line3",
      newLineNum: 3,
    });
  });

  it("4. empty new string (deletion) produces all remove lines", () => {
    const result = computeDiff("line1\nline2\nline3", "");

    expect(result.length).toBe(3);
    expect(result.every((line) => line.type === "remove")).toBe(true);

    expect(result[0]).toEqual({
      type: "remove",
      content: "line1",
      oldLineNum: 1,
    });

    expect(result[1]).toEqual({
      type: "remove",
      content: "line2",
      oldLineNum: 2,
    });

    expect(result[2]).toEqual({
      type: "remove",
      content: "line3",
      oldLineNum: 3,
    });
  });

  it("handles identical strings", () => {
    const result = computeDiff("same content", "same content");

    expect(result).toEqual([
      {
        type: "context",
        content: "same content",
        oldLineNum: 1,
        newLineNum: 1,
      },
    ]);
  });

  it("handles both empty strings", () => {
    const result = computeDiff("", "");

    expect(result).toEqual([]);
  });

  it("computes character highlights correctly for changed words", () => {
    const result = computeDiff("const foo = 42;", "const bar = 42;");

    expect(result.length).toBe(2);

    // Both lines should have highlights at the word position
    const removeLine = result.find((line) => line.type === "remove");
    const addLine = result.find((line) => line.type === "add");

    expect(removeLine?.highlights).toBeDefined();
    expect(addLine?.highlights).toBeDefined();

    // Highlights should mark "foo" vs "bar" (positions 6-9)
    expect(removeLine?.highlights).toEqual([{ start: 6, end: 9 }]);
    expect(addLine?.highlights).toEqual([{ start: 6, end: 9 }]);
  });

  it("handles multi-line additions in the middle", () => {
    const result = computeDiff("line1\nline3", "line1\nline2\nline3");

    expect(result.length).toBe(3);

    expect(result[0]).toEqual({
      type: "context",
      content: "line1",
      oldLineNum: 1,
      newLineNum: 1,
    });

    expect(result[1]).toEqual({
      type: "add",
      content: "line2",
      newLineNum: 2,
    });

    expect(result[2]).toEqual({
      type: "context",
      content: "line3",
      oldLineNum: 2,
      newLineNum: 3,
    });
  });

  it("handles multi-line removals in the middle", () => {
    const result = computeDiff("line1\nline2\nline3", "line1\nline3");

    expect(result.length).toBe(3);

    expect(result[0]).toEqual({
      type: "context",
      content: "line1",
      oldLineNum: 1,
      newLineNum: 1,
    });

    expect(result[1]).toEqual({
      type: "remove",
      content: "line2",
      oldLineNum: 2,
    });

    expect(result[2]).toEqual({
      type: "context",
      content: "line3",
      oldLineNum: 3,
      newLineNum: 2,
    });
  });
});
