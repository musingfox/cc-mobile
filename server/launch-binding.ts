import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LaunchBinding {
  cardPath: string;
  vault: string;
  project: string;
  paneId: string;
  createdAt: string;
}

/** Where the obw writeback hook looks for bindings (its `OBW_LAUNCHES_DIR` default). */
export function defaultLaunchesDir(home: string = homedir()): string {
  return join(home, ".claude-mobile", "launches");
}

/** Exclusive create: a session id binds to one card, once. Every fs error propagates. */
export async function writeLaunchBinding(
  dir: string,
  claudeUuid: string,
  binding: LaunchBinding,
): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const { cardPath, vault, project, paneId, createdAt } = binding;
  const file = join(dir, `${claudeUuid}.json`);
  await writeFile(file, JSON.stringify({ cardPath, vault, project, paneId, createdAt }), {
    flag: "wx",
    mode: 0o600,
  });
  await chmod(file, 0o600);
}
