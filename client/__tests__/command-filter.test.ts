import { describe, expect, it } from "bun:test";
import { filterAndSortItems } from "../utils/command-filter";

describe("filterAndSortItems", () => {
  it("returns all commands with correct prefix when query is empty", () => {
    const result = filterAndSortItems({
      query: "",
      commands: ["commit", "help"],
      agents: [],
      pinnedItems: [],
    });

    expect(result).toEqual([
      { label: "/commit", value: "/commit", type: "command", pinned: false },
      { label: "/help", value: "/help", type: "command", pinned: false },
    ]);
  });

  it("filters commands by substring match (case-insensitive)", () => {
    const result = filterAndSortItems({
      query: "com",
      commands: ["commit", "help"],
      agents: [],
      pinnedItems: [],
    });

    expect(result).toEqual([
      { label: "/commit", value: "/commit", type: "command", pinned: false },
    ]);
  });

  it("sorts pinned items first, then alphabetically", () => {
    const result = filterAndSortItems({
      query: "",
      commands: ["commit"],
      agents: ["github"],
      pinnedItems: ["/commit"],
    });

    expect(result).toEqual([
      { label: "/commit", value: "/commit", type: "command", pinned: true },
      { label: "@github", value: "@github", type: "agent", pinned: false },
    ]);
  });

  it("filters agents by substring match", () => {
    const result = filterAndSortItems({
      query: "git",
      commands: ["commit"],
      agents: ["github"],
      pinnedItems: [],
    });

    expect(result).toEqual([{ label: "@github", value: "@github", type: "agent", pinned: false }]);
  });

  it("returns empty array when no items exist", () => {
    const result = filterAndSortItems({
      query: "",
      commands: [],
      agents: [],
      pinnedItems: [],
    });

    expect(result).toEqual([]);
  });
});
