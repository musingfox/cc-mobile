import { homedir } from "node:os";
import { join } from "node:path";
import { resolveSocketPath } from "./transport";

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
