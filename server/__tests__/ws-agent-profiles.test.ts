import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfile, AgentProfileSource } from "../agents/profiles";
import { ServerMessage } from "../protocol";
import { startWsHarness, testServerConfig, type WsHarness } from "./ws-harness";

let harness: WsHarness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

function profileSource(profiles: AgentProfile[]): AgentProfileSource {
  return { list: () => profiles };
}

describe("AgentProfileWireExposure", () => {
  // A profile is listed only while its kind is available, and with no herdr to
  // ask that means PATH — so the test says what is installed rather than
  // leaning on the developer's own machine (the CI failure noted in
  // ws-surviving-messages.test.ts).
  const REAL_PATH = process.env.PATH;
  let binDir: string | null = null;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "ccm-profiles-wire-"));
    for (const kind of ["claude", "omp"]) {
      writeFileSync(join(binDir, kind), "#!/bin/sh\n", { mode: 0o755 });
    }
    process.env.PATH = binDir;
  });

  afterEach(() => {
    process.env.PATH = REAL_PATH;
    if (binDir) rmSync(binDir, { recursive: true, force: true });
    binDir = null;
  });

  test("server config exposes profile metadata without argv", async () => {
    harness = await startWsHarness({}, testServerConfig, {
      agentProfiles: profileSource([
        {
          id: "p1",
          label: "omp · codex",
          kind: "omp",
          args: ["--config", "/x.yml"],
        },
      ]),
    });

    harness.send({ type: "get_server_config" });
    const frame = await harness.waitFor((message) => message.type === "server_config");
    const config = frame.config as Record<string, unknown>;
    const profiles = config.agentProfiles as Record<string, unknown>[];

    expect(profiles).toEqual([{ id: "p1", label: "omp · codex", kind: "omp" }]);
    expect(Object.keys(profiles[0] ?? {}).sort()).toEqual(["id", "kind", "label"]);
    expect(ServerMessage.safeParse(frame).success).toBe(true);
  });

  test("server config includes an empty profile list", async () => {
    harness = await startWsHarness({}, testServerConfig, {
      agentProfiles: profileSource([]),
    });

    harness.send({ type: "get_server_config" });
    const frame = await harness.waitFor((message) => message.type === "server_config");
    const config = frame.config as Record<string, unknown>;

    expect(Object.keys(config).sort()).toEqual([
      "agentIntegrations",
      "agentProfiles",
      "allowedRoots",
      "availableAgents",
      "homeDirectory",
    ]);
    expect(config.agentProfiles).toEqual([]);
  });
});

describe("ConflictingSelectorRefused", () => {
  test("websocket rejects agentKind plus profileId with one error frame", async () => {
    let createSessionCalls = 0;
    harness = await startWsHarness(
      {
        createSession: async () => {
          createSessionCalls += 1;
          return { name: "cc-u1", paneRef: "7" };
        },
      },
      testServerConfig,
      {
        agentProfiles: profileSource([{ id: "p-omp", label: "omp ask", kind: "omp", args: [] }]),
      },
    );

    harness.send({
      type: "terminal_create",
      claudeUuid: "u1",
      cwd: "/tmp",
      agentKind: "omp",
      profileId: "p-omp",
    });
    const frame = await harness.waitFor((message) => message.type === "error");

    expect(frame.code).toBe("invalid_message");
    expect(harness.received).toEqual([frame]);
    expect(createSessionCalls).toBe(0);
  });
});
