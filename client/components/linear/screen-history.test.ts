import { describe, expect, test } from "bun:test";
import { planNavigation, ROOT, readStack, type ScreenEntry, seedStack } from "./screen-history";

const project = (cwd: string): ScreenEntry => ({ screen: "projectDetail", cwd });
const chat = (cwd: string | null): ScreenEntry => ({ screen: "chat", cwd });

describe("planNavigation", () => {
  test("going deeper pushes an entry", () => {
    expect(planNavigation([ROOT], project("/a"))).toEqual({
      kind: "push",
      stack: [ROOT, project("/a")],
    });
    expect(planNavigation([ROOT, project("/a")], chat("/a"))).toEqual({
      kind: "push",
      stack: [ROOT, project("/a"), chat("/a")],
    });
  });

  test("Back to a screen already below steps back over the entries above it", () => {
    const stack = [ROOT, project("/a"), chat("/a")];
    expect(planNavigation(stack, project("/a"))).toEqual({ kind: "go", delta: -1 });
    expect(planNavigation(stack, ROOT)).toEqual({ kind: "go", delta: -2 });
  });

  test("a different project at the same depth is not an ancestor", () => {
    const stack = [ROOT, project("/a"), chat("/a")];
    expect(planNavigation(stack, project("/b"))).toEqual({
      kind: "replace",
      stack: [ROOT, project("/a"), project("/b")],
    });
  });

  test("a sideways move replaces the current entry", () => {
    const stack = [ROOT, { screen: "addProject", cwd: null } as ScreenEntry];
    expect(planNavigation(stack, project("/a"))).toEqual({
      kind: "replace",
      stack: [ROOT, project("/a")],
    });
  });

  test("a project screen with no project is the project list", () => {
    expect(planNavigation([ROOT, chat(null)], { screen: "projectDetail", cwd: null })).toEqual({
      kind: "go",
      delta: -1,
    });
  });

  test("navigating to the current screen does not grow the stack", () => {
    expect(planNavigation([ROOT], ROOT)).toEqual({ kind: "replace", stack: [ROOT] });
  });
});

describe("seedStack", () => {
  test("a cold start on the root is the root alone", () => {
    expect(seedStack(ROOT)).toEqual([ROOT]);
  });

  test("a cold start in chat gets the root under it", () => {
    expect(seedStack(chat(null))).toEqual([ROOT, chat(null)]);
  });
});

describe("readStack", () => {
  test("reads the stack an entry carries", () => {
    expect(readStack({ screens: [ROOT, chat(null)] })).toEqual([ROOT, chat(null)]);
  });

  test.each([
    null,
    undefined,
    {},
    { screens: [] },
    { screens: "x" },
  ])("an entry without a stack yields null: %p", (state) => {
    expect(readStack(state)).toBeNull();
  });
});
