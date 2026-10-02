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
import { INTEGRATION_LIST_LINE } from "../herdr/wire-fixtures";
import {
  availableAgentKinds,
  DEFAULT_AGENT_KIND,
  isAgentKindAvailable,
  LAUNCHABLE_AGENT_KINDS,
  resolveAgentAvailability,
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

/** herdr's live `integration.list` answer, keyed by target the way the backend keys it. */
function liveIntegrationStates(): Record<string, string> {
  const { result } = JSON.parse(INTEGRATION_LIST_LINE) as {
    result: { integrations: { target: string; state: string }[] };
  };
  return Object.fromEntries(result.integrations.map(({ target, state }) => [target, state]));
}

describe("AgentAvailability: PATH and herdr integration", () => {
  test("herdr's own target names are the kind names, so a live answer resolves every kind", () => {
    process.env.PATH = pathWithOnly(["claude", "omp"]);

    expect(resolveAgentAvailability(liveIntegrationStates())).toEqual({
      kinds: ["claude", "omp"],
      integrations: { claude: "current", omp: "current" },
    });
  });

  test("a kind whose herdr integration is not installed is not offered, binary or not", () => {
    process.env.PATH = pathWithOnly(["claude", "omp"]);

    const availability = resolveAgentAvailability({ claude: "current", omp: "not_installed" });

    expect(availability.kinds).toEqual(["claude"]);
    expect(availability.integrations).toEqual({ claude: "current" });
  });

  test("an outdated integration is offered and flagged as outdated", () => {
    process.env.PATH = pathWithOnly(["claude", "omp"]);

    const availability = resolveAgentAvailability({ claude: "current", omp: "outdated" });

    expect(availability.kinds).toEqual(["claude", "omp"]);
    expect(availability.integrations).toEqual({ claude: "current", omp: "outdated" });
  });

  test("an installed integration does not stand in for a binary missing from PATH", () => {
    process.env.PATH = pathWithOnly(["claude"]);

    expect(resolveAgentAvailability({ claude: "current", omp: "current" }).kinds).toEqual([
      "claude",
    ]);
  });

  test("a kind herdr does not list at all is not offered", () => {
    process.env.PATH = pathWithOnly(["claude", "omp"]);

    expect(resolveAgentAvailability({ claude: "current" }).kinds).toEqual(["claude"]);
  });

  test("a state herdr has not used before counts as installed and travels as current", () => {
    process.env.PATH = pathWithOnly(["claude"]);

    expect(resolveAgentAvailability({ claude: "pending_restart" })).toEqual({
      kinds: ["claude"],
      integrations: { claude: "current" },
    });
  });

  test("when herdr could not be asked, PATH alone decides and the answer says so", () => {
    process.env.PATH = pathWithOnly(["claude", "omp"]);

    expect(resolveAgentAvailability(null)).toEqual({
      kinds: ["claude", "omp"],
      integrations: null,
    });
  });
});
