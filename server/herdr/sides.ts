import { homedir } from "node:os";
import { join } from "node:path";
import { resolveSocketPath } from "./transport";

export type Side = "cockpit" | "hangar";

export type HerdrSideSocket =
  | { side: "cockpit"; socketPath: string }
  | { side: "hangar"; name: string; socketPath: string };

export function resolveHerdrSides(
  hangarSession: string | null,
  home: string = homedir(),
): HerdrSideSocket[] {
  const sides: HerdrSideSocket[] = [{ side: "cockpit", socketPath: resolveSocketPath() }];
  if (hangarSession !== null) {
    sides.push({
      side: "hangar",
      name: hangarSession,
      socketPath: join(home, ".config", "herdr", "sessions", hangarSession, "herdr.sock"),
    });
  }
  return sides;
}

export function hangarKey(name: string, paneId: string): string {
  return `${name}@${paneId}`;
}

export function routeSessionKey(
  key: string,
  hangarName: string | null,
): { side: Side; paneId: string } {
  if (hangarName !== null) {
    const prefix = `${hangarName}@`;
    if (key.startsWith(prefix) && key.length > prefix.length) {
      return { side: "hangar", paneId: key.slice(prefix.length) };
    }
  }
  return { side: "cockpit", paneId: key };
}
