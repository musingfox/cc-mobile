import { describe, expect, test } from "bun:test";
import { readFrontmatter } from "./frontmatter";

const file = "/definition.md";

function read(text: string): () => string {
  return () => text;
}

describe("FrontmatterDescriptionRead", () => {
  test("reads description and argument hint", () => {
    expect(
      readFrontmatter({
        file,
        read: read("---\ndescription: Run the audit\nargument-hint: <path>\n---\nbody"),
      }),
    ).toEqual({ description: "Run the audit", argumentHint: "<path>" });
  });

  test("expands a literal block scalar instead of returning its marker", () => {
    const result = readFrontmatter({
      file,
      read: read("---\ndescription: |\n  First line\n  second line\n---\n"),
    });

    expect(result).toEqual({ description: "First line second line" });
    expect(result?.description).not.toBe("|");
  });

  test("expands a folded block scalar", () => {
    expect(
      readFrontmatter({
        file,
        read: read("---\ndescription: >-\n  folded text\n---\n"),
      }),
    ).toEqual({ description: "folded text" });
  });

  test("unquotes a quoted description", () => {
    expect(
      readFrontmatter({
        file,
        read: read('---\ndescription: "Quoted value"\n---\n'),
      }),
    ).toEqual({ description: "Quoted value" });
  });

  test("returns null when reading fails", () => {
    expect(
      readFrontmatter({
        file,
        read: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toBeNull();
  });

  test("returns null without frontmatter", () => {
    expect(readFrontmatter({ file, read: read("# Just a heading\n") })).toBeNull();
  });

  test("returns null when frontmatter has no supported fields", () => {
    expect(readFrontmatter({ file, read: read("---\ntitle: x\n---\n") })).toBeNull();
  });

  test("returns null for an empty description", () => {
    expect(readFrontmatter({ file, read: read("---\ndescription:\n---\n") })).toBeNull();
  });

  test("reads an argument hint without a description", () => {
    expect(readFrontmatter({ file, read: read("---\nargument-hint: <n>\n---\n") })).toEqual({
      argumentHint: "<n>",
    });
  });
});
