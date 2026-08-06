/**
 * kinds.test.ts — LaunchableAgentKinds.
 *
 * The availability check is real, not faked: it runs against a PATH the test
 * controls, so "not installed → not offered" is observed rather than asserted
 * about a mock.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  availableAgentKinds,
  DEFAULT_AGENT_KIND,
  isAgentKindAvailable,
  LAUNCHABLE_AGENT_KINDS,
} from "./kinds";

const REAL_PATH = process.env.PATH;

afterEach(() => {
  process.env.PATH = REAL_PATH;
});

/** A PATH holding executables named exactly `names`, and nothing else. */
function pathWithOnly(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ccm-kinds-"));
  for (const name of names) {
    writeFileSync(join(dir, name), "#!/bin/sh\n", { mode: 0o755 });
  }
  return dir;
}

describe("LaunchableAgentKinds", () => {
  test("the default kind is claude — what an agentKind-less create means", () => {
    expect(DEFAULT_AGENT_KIND).toBe("claude");
    expect(LAUNCHABLE_AGENT_KINDS).toContain(DEFAULT_AGENT_KIND);
  });

  test("a kind whose binary is not on PATH is not offered", () => {
    process.env.PATH = pathWithOnly(["claude"]);

    expect(isAgentKindAvailable("omp")).toBe(false);
    expect(availableAgentKinds()).toEqual(["claude"]);
  });

  test("a kind whose binary is on PATH is offered", () => {
    process.env.PATH = pathWithOnly(["claude", "omp"]);

    expect(availableAgentKinds()).toEqual(["claude", "omp"]);
  });

  test("an empty PATH offers nothing rather than defaulting to claude", () => {
    process.env.PATH = pathWithOnly([]);

    expect(availableAgentKinds()).toEqual([]);
  });
});
