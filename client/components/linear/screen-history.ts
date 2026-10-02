/**
 * screen-history.ts — which browser-history step a screen change takes.
 *
 * Android's back button and the iOS edge swipe walk the browser history, so a
 * screen the user goes deeper into must be an entry of its own, and an in-app
 * Back must step back over that entry rather than push another one. Every
 * entry's state carries the whole stack of screens up to it: the stack can then
 * be read off whichever entry is current, including after a reload.
 */

import type { LinearScreen } from "./AppShell";

export interface ScreenEntry {
  screen: LinearScreen;
  /** The project a projectDetail entry shows, carried along to deeper screens. */
  cwd: string | null;
}

export const ROOT: ScreenEntry = { screen: "projects", cwd: null };

const DEPTH: Record<LinearScreen, number> = {
  projects: 0,
  settings: 1,
  addProject: 1,
  projectDetail: 1,
  chat: 2,
};

export type HistoryStep =
  | { kind: "go"; delta: number }
  | { kind: "push" | "replace"; stack: ScreenEntry[] };

function sameScreen(a: ScreenEntry, b: ScreenEntry) {
  return a.screen === b.screen && (a.screen !== "projectDetail" || a.cwd === b.cwd);
}

export function readStack(state: unknown): ScreenEntry[] | null {
  const screens = (state as { screens?: unknown } | null)?.screens;
  return Array.isArray(screens) && screens.length > 0 ? (screens as ScreenEntry[]) : null;
}

/** A cold start below the root still gets the root under it, so back goes home. */
export function seedStack(initial: ScreenEntry): ScreenEntry[] {
  return initial.screen === ROOT.screen ? [initial] : [ROOT, initial];
}

export function planNavigation(stack: ScreenEntry[], requested: ScreenEntry): HistoryStep {
  // A project screen with no project renders the project list.
  const next = requested.screen === "projectDetail" && !requested.cwd ? ROOT : requested;
  const top = stack.length - 1;
  const ancestor = stack.findLastIndex((entry, i) => i < top && sameScreen(entry, next));
  if (ancestor >= 0) return { kind: "go", delta: ancestor - top };
  if (DEPTH[next.screen] > DEPTH[stack[top].screen]) {
    return { kind: "push", stack: [...stack, next] };
  }
  return { kind: "replace", stack: [...stack.slice(0, top), next] };
}
