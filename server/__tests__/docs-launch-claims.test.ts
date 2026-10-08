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
});
