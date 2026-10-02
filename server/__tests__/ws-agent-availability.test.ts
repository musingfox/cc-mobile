/**
 * ws-agent-availability.test.ts — what `server_config` offers, given herdr's
 * integration state (ADR-015 §2026-10-03).
 *
 * Everything between the socket and the wire is the production article: the
 * herdr client parses the daemon's answer, the herdr backend keys it, the WS
 * plugin resolves availability and sends the reply. Only the transport — the
 * unix socket itself — is stood in for, so a schema or wiring mistake anywhere
 * in that chain fails here rather than on the phone.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfileSource } from "../agents/profiles";
import { createHerdrBackend } from "../herdr/backend";
import { createHerdrClient } from "../herdr/client";
import { HerdrRpcError } from "../herdr/errors";
import type { HerdrTransport } from "../herdr/transport";
import { ServerMessage } from "../protocol";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

const REAL_PATH = process.env.PATH;
let binDir: string | null = null;
let harness: WsHarness | null = null;

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), "ccm-availability-"));
  for (const kind of ["claude", "omp"]) {
    writeFileSync(join(binDir, kind), "#!/bin/sh\n", { mode: 0o755 });
  }
  process.env.PATH = binDir;
});

afterEach(async () => {
  await harness?.close();
  harness = null;
  process.env.PATH = REAL_PATH;
  if (binDir) rmSync(binDir, { recursive: true, force: true });
  binDir = null;
});

const profiles: AgentProfileSource = {
  list: () => [
    { id: "p-claude", label: "claude · plan", kind: "claude", args: [] },
    { id: "p-omp", label: "omp · codex", kind: "omp", args: [] },
  ],
};

/** A herdr backend whose daemon answers `integration.list` with `answer`. */
function backendAnswering(answer: () => unknown) {
  const transport: HerdrTransport = {
    async request(method) {
      if (method === "integration.list") return answer();
      return { type: "ok" };
    },
  };
  return createHerdrBackend({ client: createHerdrClient({ transport }) });
}

function integrationList(states: Record<string, string>) {
  return {
    type: "integration_list",
    integrations: Object.entries(states).map(([target, state]) => ({
      target,
      label: target,
      command: target,
      available: true,
      state,
    })),
  };
}

async function serverConfig(answer: () => unknown) {
  harness = await startWsHarness(backendAnswering(answer), testServerConfig, {
    agentProfiles: profiles,
  });
  harness.send({ type: "get_server_config" });
  const frame = await harness.waitFor((message) => message.type === "server_config");
  return { frame, config: frame.config as Record<string, unknown> };
}

describe("AgentAvailabilityOnTheWire", () => {
  test("a kind whose herdr integration is not installed is absent, and so are its profiles", async () => {
    const { frame, config } = await serverConfig(() =>
      integrationList({ claude: "current", omp: "not_installed" }),
    );

    expect(config.availableAgents).toEqual(["claude"]);
    expect(config.agentIntegrations).toEqual({ claude: "current" });
    // A map naming only some kinds is the wire schema's normal case.
    expect(ServerMessage.safeParse(frame).success).toBe(true);
    expect(config.agentProfiles).toEqual([
      { id: "p-claude", label: "claude · plan", kind: "claude" },
    ]);
  });

  test("an outdated integration is listed and flagged outdated", async () => {
    const { frame, config } = await serverConfig(() =>
      integrationList({ claude: "current", omp: "outdated" }),
    );

    expect(config.availableAgents).toEqual(["claude", "omp"]);
    expect(config.agentIntegrations).toEqual({ claude: "current", omp: "outdated" });
    expect((config.agentProfiles as unknown[]).length).toBe(2);
    expect(ServerMessage.safeParse(frame).success).toBe(true);
  });

  test("an integration.list failure falls back to PATH alone, says so on the wire, and logs once", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { frame, config } = await serverConfig(() => {
        throw new HerdrRpcError(
          "invalid_request",
          "invalid request: unknown variant `integration.list`",
        );
      });
      const configReplies = () =>
        harness?.received.filter((message) => message.type === "server_config").length;
      harness?.send({ type: "get_server_config" });
      await harness?.waitFor(() => configReplies() === 2);

      expect(config.availableAgents).toEqual(["claude", "omp"]);
      expect(config.agentIntegrations).toBeNull();
      expect((config.agentProfiles as unknown[]).length).toBe(2);
      expect(ServerMessage.safeParse(frame).success).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
