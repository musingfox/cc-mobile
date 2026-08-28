/**
 * docs-profile-claims.test.ts — SecurityClaimDocCorrection and
 * ProfileProtocolDocumented.
 *
 * The project docs make a security claim about what cc-mobile can launch, and
 * that claim is read as a guarantee. Launch profiles (2026-08-28) made the old
 * wording false: cc-mobile still generates no gating flag of its own, but an
 * operator-declared profile on the server may carry any argv. A stale sentence
 * here is not a typo — it is a promise the code no longer keeps — so the
 * wording is pinned by a test rather than left to review.
 *
 * The retired sentence is assembled from fragments so this file does not
 * trip its own assertion.
 *
 * The second pair guards discoverability rather than truth: a wire field a
 * client must send (`profileId`) and one the server sends back
 * (`agentProfiles`) have to be findable in the protocol docs, or the only
 * description of the contract is the schema.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

function readDoc(name: string): string {
  return readFileSync(join(repoRoot, name), "utf8");
}

/** "cc-mobile sets no agent settings: no `--permission-mode` on launch" */
const RETIRED_CLAIM = [
  "cc-mobile sets no agent settings: no ",
  "`--",
  "permission-mode",
  "`",
  " on launch",
].join("");

describe("SecurityClaimDocCorrection", () => {
  test("CLAUDE.md credits the operator, not an absolute guarantee", () => {
    const claudeMd = readDoc("CLAUDE.md");

    expect(claudeMd).toContain("operator-declared profile");
    expect(claudeMd).not.toContain(RETIRED_CLAIM);
  });

  test("the AGENTS.md paragraph about argvFor names launch profiles", () => {
    const paragraphs = readDoc("AGENTS.md").split(/\n\s*\n/);
    const argvParagraph = paragraphs.find((p) => p.includes("argvFor"));

    expect(argvParagraph).toBeDefined();
    expect(argvParagraph).toContain("launch profile");
  });
});

describe("ProfileProtocolDocumented", () => {
  test("CLAUDE.md's protocol section names both profile fields", () => {
    const claudeMd = readDoc("CLAUDE.md");

    expect(claudeMd).toContain("profileId");
    expect(claudeMd).toContain("agentProfiles");
  });

  test("the cc-mobile.md spec names both profile fields", () => {
    const spec = readDoc("cc-mobile.md");

    expect(spec).toContain("profileId");
    expect(spec).toContain("agentProfiles");
  });
});
