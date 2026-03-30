import { beforeEach, describe, expect, test } from "bun:test";
import { loadProjects, removeProject, saveProject } from "../projects";

beforeEach(() => {
  localStorage.clear();
});

describe("saveProject LRU behavior", () => {
  test("Empty → add first", () => {
    saveProject("/Users/test/proj1");
    expect(loadProjects()).toEqual([{ cwd: "/Users/test/proj1", label: "proj1" }]);
  });

  test("Add second (most recent first)", () => {
    saveProject("/Users/test/proj1");
    saveProject("/Users/test/proj2");
    expect(loadProjects()[0].cwd).toBe("/Users/test/proj2");
  });

  test("Re-save existing (LRU bump)", () => {
    saveProject("/Users/test/proj1");
    saveProject("/Users/test/proj2");
    saveProject("/Users/test/proj1");
    expect(loadProjects()[0].cwd).toBe("/Users/test/proj1");
  });

  test("11th project evicts oldest (max 10)", () => {
    localStorage.clear();
    for (let i = 1; i <= 11; i++) saveProject(`/p${i}`);
    expect(loadProjects().length).toBe(10);
    expect(loadProjects()[0].cwd).toBe("/p11");
    expect(loadProjects().find((p) => p.cwd === "/p1")).toBeUndefined();
  });

  test("removeProject", () => {
    localStorage.clear();
    saveProject("/a");
    saveProject("/b");
    removeProject("/a");
    expect(loadProjects()).toEqual([{ cwd: "/b", label: "b" }]);
  });

  test("removeProject non-existent → no-op", () => {
    localStorage.clear();
    saveProject("/b");
    removeProject("/nonexistent");
    expect(loadProjects()).toEqual([{ cwd: "/b", label: "b" }]);
  });
});
