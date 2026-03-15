import { describe, it, expect } from "bun:test";
import { togglePin } from "../services/pins";

describe("togglePin", () => {
  it("adds item to empty pins array", () => {
    const result = togglePin({ item: "/commit", currentPins: [] });
    expect(result).toEqual(["/commit"]);
  });

  it("removes item when it exists in pins", () => {
    const result = togglePin({ item: "/commit", currentPins: ["/commit"] });
    expect(result).toEqual([]);
  });

  it("adds new item to existing pins", () => {
    const result = togglePin({ item: "@github", currentPins: ["/commit"] });
    expect(result).toEqual(["/commit", "@github"]);
  });
});
