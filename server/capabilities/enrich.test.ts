import { describe, expect, test } from "bun:test";
import { enrich } from "./enrich";

describe("CapabilityEnrichJoin", () => {
  test("T1: plugin skill description joins; unmatched names stay in the list", () => {
    const result = enrich(["obw:pm", "help"], {
      plugins: [{ name: "obw", path: "/p/obw" }],
      home: "/h",
      reader: (file) =>
        file === "/p/obw/skills/pm/SKILL.md" ? { description: "PM" } : null,
    });

    expect(result).toEqual([
      { name: "obw:pm", description: "PM" },
      { name: "help" },
    ]);
  });

  test("T2: a throwing reader degrades one entry and never the list", () => {
    const result = enrich(["obw:pm", "help"], {
      plugins: [{ name: "obw", path: "/p/obw" }],
      home: "/h",
      reader: (file) => {
        if (file.includes("/help")) throw new Error("bad frontmatter");
        if (file === "/p/obw/skills/pm/SKILL.md") return { description: "PM" };
        return null;
      },
    });

    expect(result).toEqual([
      { name: "obw:pm", description: "PM" },
      { name: "help" },
    ]);
    expect(result).toHaveLength(2);
  });

  test("T3: missing files leave names without a description key", () => {
    const result = enrich(["a", "b"], {
      reader: () => null,
    });

    expect(result).toEqual([{ name: "a" }, { name: "b" }]);
    expect("description" in result[0]!).toBe(false);
    expect("description" in result[1]!).toBe(false);
  });

  test("T4: unknown plugin prefix never calls the reader", () => {
    let calls = 0;
    const result = enrich(["nope:x"], {
      plugins: [],
      reader: () => {
        calls += 1;
        return null;
      },
    });

    expect(result).toEqual([{ name: "nope:x" }]);
    expect(calls).toBe(0);
  });

  test("T5: empty names yield an empty list", () => {
    expect(enrich([])).toEqual([]);
  });

  test("T6: plugin names try skills, commands, then agents under the plugin root", () => {
    const asked: string[] = [];
    enrich(["obw:pm"], {
      plugins: [{ name: "obw", path: "/p/obw" }],
      reader: (file) => {
        asked.push(file);
        return null;
      },
    });

    expect(asked).toEqual([
      "/p/obw/skills/pm/SKILL.md",
      "/p/obw/commands/pm.md",
      "/p/obw/agents/pm.md",
    ]);
  });

  test("T7: unprefixed names try ~/.claude skills, commands, then agents", () => {
    const asked: string[] = [];
    enrich(["help"], {
      plugins: [],
      home: "/h",
      reader: (file) => {
        asked.push(file);
        return null;
      },
    });

    expect(asked).toEqual([
      "/h/.claude/skills/help/SKILL.md",
      "/h/.claude/commands/help.md",
      "/h/.claude/agents/help.md",
    ]);
  });

  test("T8: an argument hint without a description is still joined", () => {
    const result = enrich(["x"], {
      reader: () => ({ argumentHint: "<path>" }),
    });

    expect(result).toEqual([{ name: "x", argumentHint: "<path>" }]);
  });
});
