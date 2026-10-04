import { describe, expect, test } from "bun:test";
import { emptyAgentProfileSource } from "../agents/profiles";
import { EventBuffer } from "../event-buffer";
import { createLaunchPlugin } from "../launch";
import { testServerConfig } from "./ws-harness";

function setup(opts: { token?: string | null; createError?: string; sendFails?: boolean } = {}) {
  const calls: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const backend = {
    createSession: async ({ cwd }: { cwd: string }) => {
      calls.push(`create:${cwd}`);
      if (opts.createError) throw new Error(opts.createError);
      return { name: "t", paneRef: "w1:p2" };
    },
    teardown: async () => ({ killed: false }),
    registerClient: () => {},
    send: async ({ claudeUuid, content }: { claudeUuid: string; content: string }) => {
      calls.push(`send:${claudeUuid}:${content}`);
      if (opts.sendFails) throw new Error("boom");
    },
  };
  const app = createLaunchPlugin({
    config: { ...testServerConfig, launchToken: opts.token === undefined ? "s3cret" : opts.token },
    backend,
    agentProfiles: emptyAgentProfileSource(),
    eventBuffer: new EventBuffer(10),
    auditLog: { append: async (r: Record<string, unknown>) => void audits.push(r) } as never,
  });
  const post = (body: unknown, auth: string | null = "Bearer s3cret") =>
    app.handle(
      new Request("http://localhost/api/launch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "100.1.2.3",
          ...(auth ? { authorization: auth } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { calls, audits, post };
}

const good = { cwd: "/tmp", prompt: "hello" };

describe("POST /api/launch", () => {
  test("token unset → 503, nothing called", async () => {
    const s = setup({ token: null });
    const r = await s.post(good);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "launch_disabled" });
    expect(s.calls).toEqual([]);
  });
  test("missing or wrong token → 401", async () => {
    for (const auth of [null, "Bearer nope", "s3cret"]) {
      const s = setup();
      const r = await s.post(good, auth);
      expect(r.status).toBe(401);
      expect(s.calls).toEqual([]);
    }
  });
  test("bad body → 400", async () => {
    for (const body of [
      {},
      { cwd: "", prompt: "x" },
      { cwd: "/tmp" },
      { cwd: "/tmp", prompt: "" },
    ]) {
      const r = await setup().post(body);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_body" });
    }
  });
  test("success → create then send to the pane, 201", async () => {
    const s = setup();
    const r = await s.post(good);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ sessionId: "w1:p2" });
    expect(s.calls).toEqual(["create:/tmp", "send:w1:p2:hello"]);
    expect(s.audits).toEqual([
      {
        action: "prompt_send",
        paneId: "w1:p2",
        ip: "100.1.2.3",
        device: "launch-api",
        outcome: "dispatched",
      },
    ]);
  });
  test("delivery failure → 502 with sessionId", async () => {
    const r = await setup({ sendFails: true }).post(good);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "prompt_failed", sessionId: "w1:p2" });
  });
  test("create error codes map to statuses", async () => {
    const cases: [unknown, number, string][] = [
      [{ cwd: "/definitely/not/here", prompt: "x" }, 400, "invalid_cwd"],
      [{ cwd: "/tmp", prompt: "x", profileId: "ghost" }, 400, "unknown_profile"],
    ];
    for (const [body, status, code] of cases) {
      const r = await setup().post(body);
      expect(r.status).toBe(status);
      expect((await r.json()).error).toBe(code);
    }
    const r = await setup({ createError: "herdr down" }).post(good);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "terminal_error", message: "herdr down" });
  });
  test("path outside allowed roots → 403", async () => {
    const s = setup();
    const app = createLaunchPlugin({
      config: { ...testServerConfig, launchToken: "s3cret", allowedRoots: ["/nonexistent-root"] },
      backend: {
        createSession: async () => ({ name: "", paneRef: "" }),
        teardown: async () => ({ killed: false }),
        send: async () => {},
        registerClient: () => {},
      },
      agentProfiles: emptyAgentProfileSource(),
      eventBuffer: new EventBuffer(10),
    });
    const r = await app.handle(
      new Request("http://localhost/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer s3cret" },
        body: JSON.stringify(good),
      }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("path_not_allowed");
    expect(s.calls).toEqual([]);
  });
});
