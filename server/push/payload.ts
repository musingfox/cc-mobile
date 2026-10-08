import { basename } from "node:path";

export type PushKind = "turn" | "permission" | "hangar_offline";

export interface PushPayload {
  kind: PushKind;
  title: string;
  body: string;
  tag: string;
}

/**
 * Everything a push may say about the panes behind it, and nothing else.
 *
 * A push names the project, never the work: the copy transits Apple and shows
 * on a lock screen anyone holding the phone can read. A project name is the
 * exposure the user accepted (2026-10-03); a pane title or task text is not,
 * and this type is what keeps it out — there is no field to put it in.
 * One pane is named by its cwd; several are only counted.
 */
export type PushAbout = { cwd: string | null } | { count: number };

/**
 * Longest project name a push carries, in code points. A directory name has no
 * length limit of its own, and the whole encrypted payload must fit in APNs'
 * 4 KB; past this the name is cut, deliberately.
 */
export const PROJECT_NAME_MAX = 64;

function projectOf(about: PushAbout | undefined): string | null {
  if (!about || !("cwd" in about) || !about.cwd) return null;
  const name = basename(about.cwd).trim();
  if (!name) return null;
  // Code points, not UTF-16 units: a cut through an emoji would send half of it.
  const chars = Array.from(name);
  return chars.length > PROJECT_NAME_MAX ? `${chars.slice(0, PROJECT_NAME_MAX).join("")}…` : name;
}

export function buildPayload(kind: PushKind, about?: PushAbout): PushPayload {
  if (kind === "hangar_offline") {
    return {
      kind,
      title: "CCMobile",
      body: "Hangar offline",
      tag: "cc-mobile-push-hangar-offline",
    };
  }
  const project = projectOf(about);
  if (kind === "permission") {
    return {
      kind,
      title: "CCMobile",
      body: project ? `Permission needed in ${project}` : "Permission needed",
      tag: "cc-mobile-push-permission",
    };
  }
  const count = about && "count" in about && about.count >= 2 ? about.count : null;
  return {
    kind,
    title: "CCMobile",
    body: count
      ? `${count} sessions finished`
      : project
        ? `A turn finished in ${project}`
        : "A turn finished",
    tag: "cc-mobile-push-turn",
  };
}
