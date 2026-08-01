/**
 * terminal-backend.test.ts — BackendSessionLifecycle + BackendSendRouting contracts.
 *
 * The adapter is a thin delegation layer, so every case pins one of:
 *  - argument fidelity (spy receives the caller's values unmodified)
 *  - result mapping (only tmuxName → name is transformed)
 *  - error transparency (createSession rejects with the original Error; send never throws)
 */

import { describe, expect, test } from "bun:test";
import {
  createTmuxBackend,
  type TmuxRegistryLike,
  type TmuxSendRoutingLike,
} from "./terminal-backend";

function makeRegistrySpy(overrides: Partial<TmuxRegistryLike> = {}) {
  const calls: Record<string, unknown[]> = {
    createSession: [],
    hasSession: [],
    listSessions: [],
    teardown: [],
    teardownAll: [],
  };
  const registry: TmuxRegistryLike = {
    createSession: async (input) => {
      calls.createSession.push(input);
      return { tmuxName: "ccm-u1", panePid: 42, settingsPath: "/tmp/ccm-settings-u1.json" };
    },
    hasSession: (uuid) => {
      calls.hasSession.push(uuid);
      return { present: true, panePid: 42 };
    },
    listSessions: () => {
      calls.listSessions.push(undefined);
      return ["a", "b"];
    },
    teardown: async (uuid) => {
      calls.teardown.push(uuid);
      return { killed: false };
    },
    teardownAll: async () => {
      calls.teardownAll.push(undefined);
    },
    ...overrides,
  };
  return { registry, calls };
}

function makeRoutingSpy(overrides: Partial<TmuxSendRoutingLike> = {}) {
  const calls: Record<string, unknown[]> = {
    send: [],
    registerClient: [],
    getClient: [],
    teardown: [],
    cleanupByOwner: [],
  };
  const sinks = new Map<string, (msg: Record<string, unknown>) => void>();
  const routing: TmuxSendRoutingLike = {
    send: async (params) => {
      calls.send.push(params);
    },
    registerClient: (uuid, sink, owner) => {
      calls.registerClient.push([uuid, sink, owner]);
      sinks.set(uuid, sink);
    },
    getClient: (uuid) => {
      calls.getClient.push(uuid);
      return sinks.get(uuid);
    },
    teardown: (uuid) => {
      calls.teardown.push(uuid);
    },
    cleanupByOwner: (owner) => {
      calls.cleanupByOwner.push(owner);
    },
    ...overrides,
  };
  return { routing, calls, sinks };
}

function makeBackend(
  registrySpy: { registry: TmuxRegistryLike },
  routingSpy: { routing: TmuxSendRoutingLike },
  options: Record<string, unknown> = {},
) {
  return createTmuxBackend({
    ...options,
    createRegistry: () => registrySpy.registry,
    createSendRouting: () => routingSpy.routing,
  });
}

describe("BackendSessionLifecycle", () => {
  test("createSession delegates verbatim and maps tmuxName → name", async () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);

    const result = await backend.createSession({ claudeUuid: "u1", cwd: "/tmp" });

    expect(registrySpy.calls.createSession).toEqual([{ claudeUuid: "u1", cwd: "/tmp" }]);
    expect(result).toEqual({
      name: "ccm-u1",
      panePid: 42,
      settingsPath: "/tmp/ccm-settings-u1.json",
    });
    // The rename is the port's only shape change — tmuxName must not leak through.
    expect(Object.keys(result).sort()).toEqual(["name", "panePid", "settingsPath"]);
  });

  test("createSession rejects with the registry's original Error, unwrapped", async () => {
    const original = new Error("duplicate session");
    const registrySpy = makeRegistrySpy({
      createSession: async () => {
        throw original;
      },
    });
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);

    const caught = await backend
      .createSession({ claudeUuid: "u1", cwd: "/tmp" })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(caught).toBe(original);
    expect((caught as Error).message).toBe("duplicate session");
  });

  test("hasSession passes through the registry result", () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);

    expect(backend.hasSession("u1")).toEqual({ present: true, panePid: 42 });
    expect(registrySpy.calls.hasSession).toEqual(["u1"]);
  });

  test("listLive returns the registry's live uuids", () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);

    expect(backend.listLive()).toEqual(["a", "b"]);
  });

  test("teardown of an unknown uuid is idempotent and still cancels the send waiter", async () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);

    const result = await backend.teardown("unknown-uuid");

    expect(result).toEqual({ killed: false });
    expect(registrySpy.calls.teardown).toEqual(["unknown-uuid"]);
    expect(routingSpy.calls.teardown).toEqual(["unknown-uuid"]);
  });

  test("teardown kills the session before cancelling the waiter and returns the registry result", async () => {
    const order: string[] = [];
    const registrySpy = makeRegistrySpy({
      teardown: async (uuid) => {
        order.push(`registry:${uuid}`);
        return { killed: true };
      },
    });
    const routingSpy = makeRoutingSpy({
      teardown: (uuid) => {
        order.push(`routing:${uuid}`);
      },
    });
    const backend = makeBackend(registrySpy, routingSpy);

    const result = await backend.teardown("u1");

    expect(result).toEqual({ killed: true });
    expect(order).toEqual(["registry:u1", "routing:u1"]);
  });

  test("teardownAll delegates to the registry", async () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);

    await backend.teardownAll();

    expect(registrySpy.calls.teardownAll.length).toBe(1);
  });
});

describe("BackendSendRouting", () => {
  test("registerClient and send delegate field-for-field", async () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);
    const sinkFn = () => {};
    const ownerObj = {};

    backend.registerClient("u1", sinkFn, ownerObj);
    await backend.send({ claudeUuid: "u1", content: "hi" });

    expect(routingSpy.calls.registerClient).toEqual([["u1", sinkFn, ownerObj]]);
    expect(routingSpy.calls.send).toEqual([{ claudeUuid: "u1", content: "hi" }]);
  });

  test("getClient returns the same sink reference", () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);
    const sinkFn = () => {};

    backend.registerClient("u1", sinkFn);

    expect(backend.getClient("u1")).toBe(sinkFn);
  });

  test("cleanupByOwner forwards the same owner reference and does not cancel waiters", () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    const backend = makeBackend(registrySpy, routingSpy);
    const ownerObj = {};

    backend.cleanupByOwner(ownerObj);

    expect(routingSpy.calls.cleanupByOwner.length).toBe(1);
    expect(routingSpy.calls.cleanupByOwner[0]).toBe(ownerObj);
    // A transient disconnect must not cancel the reply waiter (tmux-send-routing E2).
    expect(routingSpy.calls.teardown).toEqual([]);
  });

  test("send resolves and lets the routing layer report tmux_send_failed through the sink", async () => {
    const registrySpy = makeRegistrySpy();
    const seen: Record<string, unknown>[] = [];
    const routingSpy = makeRoutingSpy();
    routingSpy.routing.send = async ({ claudeUuid }) => {
      routingSpy.sinks.get(claudeUuid)?.({
        type: "error",
        sessionId: claudeUuid,
        code: "tmux_send_failed",
        message: "not reachable",
      });
    };
    const backend = makeBackend(registrySpy, routingSpy);

    backend.registerClient("u1", (msg) => seen.push(msg));
    await backend.send({ claudeUuid: "u1", content: "hi" });

    expect(seen).toEqual([
      { type: "error", sessionId: "u1", code: "tmux_send_failed", message: "not reachable" },
    ]);
  });

  test("send of an unregistered uuid is a silent no-op", async () => {
    const registrySpy = makeRegistrySpy();
    const routingSpy = makeRoutingSpy();
    routingSpy.routing.send = async ({ claudeUuid }) => {
      if (!routingSpy.sinks.has(claudeUuid)) return;
      throw new Error("should not reach");
    };
    const backend = makeBackend(registrySpy, routingSpy);

    await expect(backend.send({ claudeUuid: "nobody", content: "hi" })).resolves.toBeUndefined();
  });
});

describe("collaborator wiring", () => {
  test("options are split across registry and send routing", () => {
    let registryOptions: unknown;
    let routingOptions: unknown;
    const runCommand = async () => ({ code: 0, stdout: "", stderr: "" });
    const { registry } = makeRegistrySpy();
    const { routing } = makeRoutingSpy();

    createTmuxBackend({
      runCommand,
      claudeBin: "sleep",
      responseUrl: "http://127.0.0.1:3001/api/pty-response",
      permissionUrl: "http://127.0.0.1:3001/api/pty-permission",
      createRegistry: (options) => {
        registryOptions = options;
        return registry;
      },
      createSendRouting: (options) => {
        routingOptions = options;
        return routing;
      },
    });

    expect(registryOptions).toEqual({
      runCommand,
      claudeBin: "sleep",
      responseUrl: "http://127.0.0.1:3001/api/pty-response",
      permissionUrl: "http://127.0.0.1:3001/api/pty-permission",
    });
    expect(routingOptions).toEqual({ runCommand, responseRelay: undefined });
  });

  test("default construction wires the real tmux modules", () => {
    const backend = createTmuxBackend({ claudeBin: "sleep" });

    expect(backend.listLive()).toEqual([]);
    expect(backend.hasSession("nobody")).toEqual({ present: false });
    expect(backend.getClient("nobody")).toBeUndefined();
  });
});
