/**
 * docs-launch-claims.test.ts — LaunchDocsCurrent.
 *
 * The retired launch description (prompt body, cockpit-only) is assembled from
 * fragments so this file does not trip its own assertion.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const doc = readFileSync(join(import.meta.dir, "..", "..", "CLAUDE.md"), "utf8");

describe("CLAUDE.md launch docs", () => {
  test("does not carry the retired prompt-and-cockpit description", () => {
    expect(doc).not.toContain(["there is no way to name", "the hangar yet"].join(" "));
    expect(doc).not.toContain(["`{cwd, prompt,", "profileId?}`"].join(" "));
  });

  test("names the card launch's body, reply, env, binding and refusal codes", () => {
    for (const term of [
      "cardPath",
      "claudeUuid",
      "CC_MOBILE_VAULT_ROOT",
      "hangar_unavailable",
      "vault_unconfigured",
      "binding_failed",
      ".claude-mobile/launches",
    ]) {
      expect(doc).toContain(term);
    }
  });

  test("states the check order and the hangar-less exception as built", () => {
    const flat = doc.replace(/\s+/g, " ");
    expect(flat).not.toContain("contains `..`");
    expect(flat).toContain("has a `..` path segment");
    expect(flat.indexOf("`403 card_not_allowed`")).toBeLessThan(
      flat.indexOf("that then cannot be read"),
    );
    expect(flat).toContain("except that `POST /api/launch` answers `503 hangar_unavailable`");
  });

  test("documents the hangar cap and its queue", () => {
    for (const term of [
      "CC_MOBILE_HANGAR_CAP",
      "202 {queued: true, position}",
      "409 already_queued",
      "503 hangar_offline",
      "hangar: {cap, occupied, queued}",
      "agent.list",
      "restart empties the queue",
    ]) {
      expect(doc.replace(/\s+/g, " ")).toContain(term);
    }
  });

  test("states how queued, admitted and dequeued launches answer", () => {
    const flat = doc.replace(/\s+/g, " ");
    expect(flat).toContain("waiting, or admitted and still starting, answers `409 already_queued`");
    expect(flat).toContain("waits for a hangar slot or was admitted and is still starting");
    expect(flat).toContain("come after `unknown_profile` and before the worktree checks");
    expect(flat).toContain(
      "still writes today's `prompt_send` audit line, `failed`, or `rejected` when the pane was busy",
    );
    expect(flat).toContain(
      "`hangar.queued` counts only launches still waiting for a slot; one that is starting is counted in `occupied`",
    );
  });
});
