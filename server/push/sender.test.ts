import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttemptLog } from "./attempt-log";
import { createPushSender, DEFAULT_VAPID_SUBJECT } from "./sender";

// Every `createPushSender` here is handed an attempt log under `tmp`, including
// the cases that never reach the append loop. Left out, the sender falls back to
// the real `~/.claude-mobile/push-attempts.jsonl` — the one file the human reads
// after a physical-device test — and a suite run fills it with fixtures.

let tmp: string;
let logPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "sender-attempt-"));
  logPath = join(tmp, "a.jsonl");
});

afterEach(() => {
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("PushAttemptLog via sender", () => {
  test("T1: dispatch to apple resolves 201 -> log has kind turn host status 201 reason null", async () => {
    const log = createAttemptLog({ path: logPath });
    const fakeSend = async () => ({ statusCode: 201 });
    const sender = createPushSender({ attemptLog: log, send: fakeSend });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/abc", keys: {} }], {
      publicKey: "p",
      privateKey: "pr",
    });
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.kind).toBe("turn");
    expect(last.host).toBe("web.push.apple.com");
    expect(last.status).toBe(201);
    expect(last.reason).toBe(null);
  });

  test("T2: send rejects 410 -> log status 410 reason", async () => {
    const log = createAttemptLog({ path: logPath });
    const fakeSend = async () => {
      throw { statusCode: 410, body: '{"reason":"ExpiredToken"}' };
    };
    const sender = createPushSender({ attemptLog: log, send: fakeSend });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/x", keys: {} }], {
      publicKey: "p",
      privateKey: "pr",
    });
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.status).toBe(410);
    expect(last.reason).toBe("ExpiredToken");
  });

  test("T3: send rejects Error -> status null non-empty reason", async () => {
    const log = createAttemptLog({ path: logPath });
    const fakeSend = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const sender = createPushSender({ attemptLog: log, send: fakeSend });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/x", keys: {} }], {
      publicKey: "p",
      privateKey: "pr",
    });
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.status).toBe(null);
    expect(last.reason && last.reason.length > 0).toBe(true);
  });

  test("T4: 2 subs -> 2 log lines", async () => {
    const log = createAttemptLog({ path: logPath });
    const calls: any[] = [];
    const fakeSend = async (s: any) => {
      calls.push(s);
      return { statusCode: 201 };
    };
    const sender = createPushSender({ attemptLog: log, send: fakeSend });
    await sender.dispatch(
      "turn",
      [
        { endpoint: "https://web.push.apple.com/1", keys: {} },
        { endpoint: "https://web.push.apple.com/2", keys: {} },
      ],
      { publicKey: "p", privateKey: "pr" },
    );
    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });
});

describe("PushDispatch", () => {
  test("T1: dispatch turn with 2 subs + vapid calls send twice; payload=build turn; TTL=300 normal", async () => {
    const calls: any[] = [];
    const fakeSend = async (s: any, p: string, o: any) => {
      calls.push({ s, p, o });
      return { statusCode: 201 };
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
    });
    // will use real payload after impl
    const res = await sender.dispatch(
      "turn",
      [
        { endpoint: "https://a/1", keys: { p256dh: "x", auth: "y" } },
        { endpoint: "https://a/2", keys: { p256dh: "x", auth: "y" } },
      ],
      { publicKey: "pub", privateKey: "priv" },
    );
    expect(res.attempted).toBe(2);
    expect(calls.length).toBe(2);
    expect(calls[0].p).toContain('"kind":"turn"');
    expect(calls[0].o.TTL).toBe(300);
    expect(calls[0].o.urgency).toBe("normal");
  });

  test("T2: dispatch permission uses TTL=90 high", async () => {
    const calls: any[] = [];
    const fakeSend = async (_s: any, _p: string, o: any) => {
      calls.push(o);
      return {};
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
    });
    await sender.dispatch("permission", [{ endpoint: "https://a/1", keys: {} }], {
      publicKey: "p",
      privateKey: "r",
    });
    expect(calls[0].TTL).toBe(90);
    expect(calls[0].urgency).toBe("high");
  });

  test("T3: TTL configured 0 becomes 1 in options", async () => {
    const calls: any[] = [];
    const fakeSend = async (_s: any, _p: string, o: any) => {
      calls.push(o);
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
      ttl: { permission: 0, turn: 0 },
    });
    await sender.dispatch("turn", [{ endpoint: "e", keys: {} }], {
      publicKey: "p",
      privateKey: "r",
    });
    expect(calls[0].TTL).toBe(1);
  });

  test("T4: no VAPID -> attempted 0, send never called, warned once", async () => {
    let called = 0;
    const warnings: string[] = [];
    const fakeSend = async () => {
      called++;
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
      warn: (m) => warnings.push(m),
    });
    const res = await sender.dispatch("turn", [{ endpoint: "e", keys: {} }]); // no vapid
    await sender.dispatch("turn", [{ endpoint: "e", keys: {} }]);
    expect(res.attempted).toBe(0);
    expect(called).toBe(0);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("VAPID");
  });

  test("T7: every request carries vapidDetails with subject and both keys", async () => {
    const calls: any[] = [];
    const fakeSend = async (_s: any, _p: string, o: any) => {
      calls.push(o);
      return { statusCode: 201 };
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
    });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/1", keys: {} }], {
      publicKey: "pub",
      privateKey: "priv",
    });
    expect(calls[0].vapidDetails).toEqual({
      subject: DEFAULT_VAPID_SUBJECT,
      publicKey: "pub",
      privateKey: "priv",
    });
  });

  test("T8: a send that reports no status is never credited with a 201", async () => {
    const log = createAttemptLog({ path: logPath });
    const sender = createPushSender({ attemptLog: log, send: async () => undefined });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/1", keys: {} }], {
      publicKey: "p",
      privateKey: "r",
    });
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.status).toBe(null);
  });

  test("T9: with no injected transport the real web-push request is what runs", async () => {
    // Junk VAPID keys are rejected by web-push's own validation before any
    // socket is opened — so this proves the default transport is wired
    // without contacting Apple. Pre-fix this logged a fabricated 201.
    const log = createAttemptLog({ path: logPath });
    const sender = createPushSender({ attemptLog: log });
    const res = await sender.dispatch(
      "turn",
      [{ endpoint: "https://web.push.apple.com/abc", keys: { p256dh: "BN", auth: "k1" } }],
      { publicKey: "not-a-real-key", privateKey: "not-a-real-key" },
    );
    expect(res.attempted).toBe(1);
    const last = JSON.parse(readFileSync(logPath, "utf8").trim().split("\n").pop()!);
    expect(last.status).toBe(null);
    expect(last.reason).toBeTruthy();
  });

  test("T5: empty store -> 0, no send", async () => {
    let called = 0;
    const fake = async () => {
      called++;
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fake,
    });
    const res = await sender.dispatch("turn", [], { publicKey: "p", privateKey: "r" });
    expect(res.attempted).toBe(0);
    expect(called).toBe(0);
  });

  test("T6: first send rejects, second still called, resolves", async () => {
    const calls: string[] = [];
    const fakeSend = async (s: any) => {
      calls.push(s.endpoint);
      if (s.endpoint.includes("1")) throw { statusCode: 500 };
      return { statusCode: 201 };
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
    });
    const res = await sender.dispatch(
      "turn",
      [
        { endpoint: "https://e/1", keys: {} },
        { endpoint: "https://e/2", keys: {} },
      ],
      { publicKey: "p", privateKey: "r" },
    );
    expect(calls).toEqual(["https://e/1", "https://e/2"]);
    expect(res.attempted).toBe(2); // still attempted both
  });
});

describe("PushExpiredSubscriptionPruned via sender", () => {
  test("T1: 410 on first prunes, second survives", async () => {
    const removed: string[] = [];
    const fakeStore = { remove: (e: string) => removed.push(e) };
    const fakeSend = async (s: any) => {
      if (s.endpoint.includes("1")) throw { statusCode: 410 };
      return { statusCode: 201 };
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
      store: fakeStore,
    });
    await sender.dispatch(
      "turn",
      [
        { endpoint: "https://web.push.apple.com/1", keys: {} },
        { endpoint: "https://web.push.apple.com/2", keys: {} },
      ],
      { publicKey: "p", privateKey: "r" },
    );
    expect(removed).toContain("https://web.push.apple.com/1");
  });

  test("T2: 404 prunes to zero", async () => {
    const removed: string[] = [];
    const fakeStore = { remove: (e: string) => removed.push(e) };
    const fakeSend = async () => {
      throw { statusCode: 404 };
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
      store: fakeStore,
    });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/1", keys: {} }], {
      publicKey: "p",
      privateKey: "r",
    });
    expect(removed.length).toBe(1);
  });

  test("T3: 429 no prune", async () => {
    const removed: string[] = [];
    const fakeStore = { remove: (e: string) => removed.push(e) };
    const fakeSend = async () => {
      throw { statusCode: 429 };
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
      store: fakeStore,
    });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/1", keys: {} }], {
      publicKey: "p",
      privateKey: "r",
    });
    expect(removed.length).toBe(0);
  });

  test("T4: error no prune", async () => {
    const removed: string[] = [];
    const fakeStore = { remove: (e: string) => removed.push(e) };
    const fakeSend = async () => {
      throw new Error("hangup");
    };
    const sender = createPushSender({
      attemptLog: createAttemptLog({ path: logPath }),
      send: fakeSend,
      store: fakeStore,
    });
    await sender.dispatch("turn", [{ endpoint: "https://web.push.apple.com/1", keys: {} }], {
      publicKey: "p",
      privateKey: "r",
    });
    expect(removed.length).toBe(0);
  });
});
