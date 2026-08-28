import { afterEach, describe, expect, test } from "bun:test";
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
    expect(Object.keys(profiles[0]!).sort()).toEqual(["id", "kind", "label"]);
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
        agentProfiles: profileSource([
          { id: "p-omp", label: "omp ask", kind: "omp", args: [] },
        ]),
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
