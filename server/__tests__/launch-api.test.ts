import { dlopen, FFIType, ptr } from "bun:ffi";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentProfile, emptyAgentProfileSource } from "../agents/profiles";
import { EventBuffer } from "../event-buffer";
import { createLaunchPlugin } from "../launch";
import { composeLaunchPrompt } from "../launch-prompt";
import { cardKey, createLaunchQueue } from "../launch-queue";
import type { CardWorktreeRequest, CardWorktreeResult } from "../launch-worktree";
import type { CreateSessionInput } from "../terminal-backend";
import { testServerConfig } from "./ws-harness";

/** The unit tier may not spawn a process, so the FIFO comes from libc directly. */
function mkfifo(path: string): number {
  const lib = process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6";
  const { symbols, close } = dlopen(lib, {
    mkfifo: { args: [FFIType.ptr, FFIType.u16], returns: FFIType.i32 },
  });
  try {
    return symbols.mkfifo(ptr(Buffer.from(`${path}\0`)), 0o600);
  } finally {
    close();
  }
}

const CARD = "# Task\nCARD-BODY do the thing\n";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let tmp: string;
let vault: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "launch-api-"));
  vault = join(tmp, "obsidian");
  mkdirSync(join(vault, "pm", "cc-mobile", "tasks"), { recursive: true });
  writeFileSync(join(vault, "pm", "cc-mobile", "tasks", "card.md"), CARD);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const claudeAuto: AgentProfile = {
  id: "claude-auto",
  label: "auto",
  kind: "claude",
  args: ["--permission-mode", "auto"],
};

interface SetupOptions {
  token?: string | null;
  hangarSession?: string | null;
  vaultRoot?: string | null;
  allowedRoots?: string[] | null;
  createError?: string;
  sendFails?: boolean;
  teardownFails?: boolean;
  launchesDir?: string;
  profiles?: AgentProfile[];
  worktree?: CardWorktreeResult;
  cap?: number;
  /** What the hangar reports; change `s.occupancy.value` to move it. */
  occupancy?: number | null | Error;
  /** `send` waits for this before answering. */
  holdSend?: Promise<unknown>;
}

function setup(opts: SetupOptions = {}) {
  const calls: string[] = [];
  // `calls` is writes only; `events` also records each occupancy read.
  const events: string[] = [];
  const record = (event: string) => {
    calls.push(event);
    events.push(event);
  };
  const occupancy = {
    value: opts.occupancy === undefined ? (0 as number | null | Error) : opts.occupancy,
    reads: 0,
  };
  const logs: string[] = [];
  const timers = { set: [] as (() => void)[], cleared: 0 };
  const queue = createLaunchQueue({
    cap: opts.cap ?? 4,
    occupancy: async () => {
      occupancy.reads += 1;
      events.push("occupancy");
      if (occupancy.value instanceof Error) throw occupancy.value;
      return occupancy.value;
    },
    setIntervalFn: (fn) => timers.set.push(fn),
    clearIntervalFn: () => {
      timers.cleared += 1;
    },
    log: (line) => logs.push(line),
  });
  /** Fires the queue's poll and lets the launch it starts run to its end. */
  const tick = async (cardPath: string = good.cardPath) => {
    timers.set[timers.set.length - 1]();
    const key = cardKey(good.vault, cardPath);
    for (let i = 0; i < 400 && queue.has(key); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const worktreeRequests: CardWorktreeRequest[] = [];
  const creates: CreateSessionInput[] = [];
  const sends: { claudeUuid: string; content: string; confirmStart?: boolean }[] = [];
  const audits: Record<string, unknown>[] = [];
  const launchesDir = opts.launchesDir ?? join(tmp, "launches");
  const bindingAtSend: { text: string | null }[] = [];
  const backend = {
    createSession: async (input: CreateSessionInput) => {
      record(`create:${input.cwd}`);
      creates.push(input);
      if (opts.createError) throw new Error(opts.createError);
      return { name: "t", paneRef: "fleet@w1:p2" };
    },
    teardown: async (key: string) => {
      record(`teardown:${key}`);
      if (opts.teardownFails) throw new Error("teardown boom");
      return { killed: true };
    },
    registerClient: () => {},
    send: async (params: { claudeUuid: string; content: string; confirmStart?: boolean }) => {
      record(`send:${params.claudeUuid}`);
      sends.push(params);
      await opts.holdSend;
      const file = join(launchesDir, `${creates[0]?.claudeUuid}.json`);
      bindingAtSend.push({ text: existsSync(file) ? readFileSync(file, "utf8") : null });
      if (opts.sendFails) throw new Error("boom");
      return { ok: true as const };
    },
  };
  const app = createLaunchPlugin({
    config: {
      ...testServerConfig,
      launchToken: opts.token === undefined ? "s3cret" : opts.token,
      hangarSession: opts.hangarSession === undefined ? "fleet" : opts.hangarSession,
      vaultRoot: opts.vaultRoot === undefined ? vault : opts.vaultRoot,
      ...(opts.allowedRoots !== undefined ? { allowedRoots: opts.allowedRoots } : {}),
    },
    backend,
    agentProfiles: opts.profiles
      ? { list: () => opts.profiles as AgentProfile[] }
      : emptyAgentProfileSource(),
    eventBuffer: new EventBuffer(10),
    launchesDir,
    worktrees: {
      create: async (request: CardWorktreeRequest) => {
        worktreeRequests.push(request);
        record(`worktree:${request.cwd}:${request.cardName}`);
        return opts.worktree ?? { kind: "not_a_repo" };
      },
      remove: async (worktree: { path: string }) => {
        record(`remove:${worktree.path}`);
      },
    },
    queue,
    auditLog: { append: async (r: Record<string, unknown>) => void audits.push(r) } as never,
  });
  const post = (
    body: unknown,
    auth: string | null = "Bearer s3cret",
    headers: Record<string, string> = {},
  ) =>
    app.handle(
      new Request("http://localhost/api/launch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "100.1.2.3",
          ...headers,
          ...(auth ? { authorization: auth } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const launches = () => (existsSync(launchesDir) ? readdirSync(launchesDir) : []);
  return {
    opts,
    calls,
    worktreeRequests,
    creates,
    sends,
    audits,
    post,
    launchesDir,
    launches,
    bindingAtSend,
    queue,
    occupancy,
    logs,
    events,
    timers,
    tick,
  };
}

const good = {
  cwd: "/tmp",
  cardPath: "pm/cc-mobile/tasks/card.md",
  vault: "obsidian",
  project: "cc-mobile",
};

function nothingHappened(s: ReturnType<typeof setup>) {
  expect(s.calls).toEqual([]);
  expect(s.launches()).toEqual([]);
  expect(s.audits).toEqual([]);
}

describe("LaunchUnauthenticatedHasNoEffect", () => {
  test("T1-T3 a missing, wrong or prefix-less token is refused with no effect", async () => {
    for (const auth of [null, "Bearer nope", "s3cret"]) {
      const s = setup();
      const r = await s.post(good, auth);
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "unauthorized" });
      nothingHappened(s);
    }
  });
  test("T4 authentication precedes the hangar and vault checks", async () => {
    const s = setup({ hangarSession: null, vaultRoot: null });
    expect((await s.post(good, null)).status).toBe(401);
  });
  test("T5 no configured token is launch_disabled", async () => {
    const s = setup({ token: null });
    const r = await s.post(good);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "launch_disabled" });
    nothingHappened(s);
  });
});

describe("LaunchRequiresHangar", () => {
  test("T1 no hangar session is refused", async () => {
    const s = setup({ hangarSession: null });
    const r = await s.post(good);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "hangar_unavailable" });
    nothingHappened(s);
  });
  test("T2 the check precedes body validation", async () => {
    const r = await setup({ hangarSession: null }).post({});
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "hangar_unavailable" });
  });
});

describe("LaunchRequiresVaultRoot", () => {
  test("T1 no vault root is refused", async () => {
    const s = setup({ vaultRoot: null });
    const r = await s.post(good);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "vault_unconfigured" });
    nothingHappened(s);
  });
  test("T2 the hangar check runs first", async () => {
    const r = await setup({ vaultRoot: null, hangarSession: null }).post(good);
    expect(await r.json()).toEqual({ error: "hangar_unavailable" });
  });
});

describe("LaunchBodyShape", () => {
  test("T1 the old prompt shape is refused", async () => {
    const s = setup();
    const r = await s.post({ cwd: "/tmp", prompt: "hello" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_body" });
    nothingHappened(s);
  });
  test("T2 an unsafe project name is refused", async () => {
    for (const project of [".hidden", "..", "a/b", "my proj", ""]) {
      const s = setup();
      const r = await s.post({ ...good, project });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_body" });
      nothingHappened(s);
    }
  });
  test("T3 a missing vault, a missing cardPath or an empty cwd is refused", async () => {
    const { vault: _v, ...noVault } = good;
    const { cardPath: _c, ...noCard } = good;
    for (const body of [noVault, noCard, { ...good, cwd: "" }]) {
      const r = await setup().post(body);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_body" });
    }
  });
  test("T4 a prompt key is ignored", async () => {
    const s = setup();
    const r = await s.post({ ...good, prompt: "IGNORED-TEXT" });
    expect(r.status).toBe(201);
    expect(s.sends).toHaveLength(1);
    expect(s.sends[0].content).not.toContain("IGNORED-TEXT");
  });
});

describe("LaunchVaultNameMatch", () => {
  test("T1-T2 a different or differently-cased vault name is refused", async () => {
    for (const name of ["other", "Obsidian"]) {
      const s = setup();
      const r = await s.post({ ...good, vault: name });
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "vault_mismatch" });
      nothingHappened(s);
    }
  });
  test("T3 the matching vault launches", async () => {
    expect((await setup().post(good)).status).toBe(201);
  });
});

describe("CardPathLexicalRefusal", () => {
  test("T1 an absolute path is refused", async () => {
    const s = setup();
    const r = await s.post({ ...good, cardPath: join(vault, good.cardPath) });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_card_path" });
    nothingHappened(s);
  });
  test("T2 a .. segment is refused although it resolves inside", async () => {
    const s = setup();
    const r = await s.post({ ...good, cardPath: "pm/../pm/cc-mobile/tasks/card.md" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_card_path" });
    nothingHappened(s);
  });
  test("T3 a non-Markdown file is refused", async () => {
    writeFileSync(join(vault, "pm", "cc-mobile", "tasks", "notes.txt"), "x");
    const s = setup();
    const r = await s.post({ ...good, cardPath: "pm/cc-mobile/tasks/notes.txt" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_card_path" });
    nothingHappened(s);
  });
});

describe("CardPathContainment", () => {
  test("T1 a symlink out of the vault is refused and never read", async () => {
    mkdirSync(join(tmp, "outside"));
    writeFileSync(join(tmp, "outside", "secret.md"), "SENTINEL-OUTSIDE");
    symlinkSync(join(tmp, "outside", "secret.md"), join(vault, "pm", "evil.md"));
    const s = setup();
    const r = await s.post({ ...good, cardPath: "pm/evil.md" });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "card_not_allowed" });
    nothingHappened(s);
    expect(JSON.stringify(s.sends)).not.toContain("SENTINEL-OUTSIDE");
  });
  test("R1 a symlink to an outside file this process cannot read is still 403", async () => {
    mkdirSync(join(tmp, "outside"));
    writeFileSync(join(tmp, "outside", "locked.md"), "SENTINEL-OUTSIDE");
    chmodSync(join(tmp, "outside", "locked.md"), 0);
    symlinkSync(join(tmp, "outside", "locked.md"), join(vault, "pm", "evil.md"));
    const s = setup();
    const r = await s.post({ ...good, cardPath: "pm/evil.md" });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "card_not_allowed" });
    nothingHappened(s);
  });
  test("T2 a vault root that is itself a symlink still launches", async () => {
    mkdirSync(join(tmp, "link"));
    symlinkSync(vault, join(tmp, "link", "obsidian"));
    const s = setup({ vaultRoot: join(tmp, "link", "obsidian") });
    expect((await s.post(good)).status).toBe(201);
  });
  const sentinel = () => {
    mkdirSync(join(tmp, "outside"), { recursive: true });
    writeFileSync(join(tmp, "outside", "secret.md"), "SENTINEL-OUTSIDE");
  };
  const refused = async (cardPath: string) => {
    const s = setup();
    const r = await s.post({ ...good, cardPath });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "card_not_allowed" });
    nothingHappened(s);
    expect(JSON.stringify(s.sends)).not.toContain("SENTINEL-OUTSIDE");
  };
  test("T3 a link to a readable file in an execute-only outside directory is 403", async () => {
    const xdir = join(tmp, "outside", "xdir");
    mkdirSync(xdir, { recursive: true });
    writeFileSync(join(xdir, "secret.md"), "SENTINEL-OUTSIDE");
    chmodSync(xdir, 0o111);
    try {
      symlinkSync(join(xdir, "secret.md"), join(vault, "pm", "evil.md"));
      await refused("pm/evil.md");
    } finally {
      chmodSync(xdir, 0o755);
    }
  });
  test("T4 a link to an execute-only outside directory is 403", async () => {
    const xdir = join(tmp, "outside", "xdir");
    mkdirSync(xdir, { recursive: true });
    writeFileSync(join(xdir, "secret.md"), "SENTINEL-OUTSIDE");
    chmodSync(xdir, 0o111);
    try {
      symlinkSync(xdir, join(vault, "pm", "linkdir"));
      await refused("pm/linkdir/secret.md");
    } finally {
      chmodSync(xdir, 0o755);
    }
  });
  test("T5 a relative link out of the vault is 403", async () => {
    sentinel();
    symlinkSync("../../outside/secret.md", join(vault, "pm", "rel.md"));
    await refused("pm/rel.md");
  });
  test("T6 a sibling directory sharing the vault's name prefix is 403", async () => {
    mkdirSync(join(tmp, "obsidian-evil"));
    writeFileSync(join(tmp, "obsidian-evil", "secret.md"), "SENTINEL-OUTSIDE");
    symlinkSync(join(tmp, "obsidian-evil", "secret.md"), join(vault, "pm", "sib.md"));
    await refused("pm/sib.md");
  });
  test("T7 a link out of the vault and back to a card inside launches", async () => {
    mkdirSync(join(tmp, "outside"));
    symlinkSync(
      join(vault, "pm", "cc-mobile", "tasks", "card.md"),
      join(tmp, "outside", "back.md"),
    );
    symlinkSync(join(tmp, "outside"), join(vault, "pm", "out"));
    const s = setup();
    expect((await s.post({ ...good, cardPath: "pm/out/back.md" })).status).toBe(201);
    expect(s.sends).toHaveLength(1);
    expect(s.sends[0]?.content).toBe(composeLaunchPrompt(CARD));
  });
  test("T8 a card under an execute-only directory inside the vault launches", async () => {
    const dir = join(vault, "pm", "x111");
    mkdirSync(dir);
    writeFileSync(join(dir, "card.md"), CARD);
    chmodSync(dir, 0o111);
    try {
      const s = setup();
      expect((await s.post({ ...good, cardPath: "pm/x111/card.md" })).status).toBe(201);
      expect(s.sends).toHaveLength(1);
      expect(s.sends[0]?.content).toBe(composeLaunchPrompt(CARD));
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});

describe("CardReadFailure", () => {
  test("T1 a missing card is 404", async () => {
    const s = setup();
    const r = await s.post({ ...good, cardPath: "pm/cc-mobile/tasks/missing.md" });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "card_not_found" });
    nothingHappened(s);
  });
  test("T2 a directory is 404", async () => {
    mkdirSync(join(vault, "pm", "dir.md"));
    const s = setup();
    const r = await s.post({ ...good, cardPath: "pm/dir.md" });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "card_not_found" });
    nothingHappened(s);
  });
  const settlesNotFound = async (s: ReturnType<typeof setup>, cardPath: string) => {
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2000));
    const r = await Promise.race([s.post({ ...good, cardPath }), timeout]);
    expect(r).not.toBe("timeout");
    const res = r as Response;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "card_not_found" });
    nothingHappened(s);
  };
  test("T3 a card the server cannot read is 404", async () => {
    const file = join(vault, "pm", "locked.md");
    writeFileSync(file, CARD);
    chmodSync(file, 0);
    try {
      await settlesNotFound(setup(), "pm/locked.md");
    } finally {
      chmodSync(file, 0o600);
    }
  });
  test("T4 a FIFO with no writer settles as 404 instead of blocking", async () => {
    const fifo = join(vault, "pm", "fifo.md");
    expect(mkfifo(fifo)).toBe(0);
    await settlesNotFound(setup(), "pm/fifo.md");
  });
  test("T5 a vault root that does not exist is 404", async () => {
    const s = setup({ vaultRoot: join(tmp, "nope") });
    const r = await s.post({ ...good, vault: "nope" });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "card_not_found" });
    nothingHappened(s);
  });
  test("T6 a dangling link, a link loop and a file used as a directory settle as 404", async () => {
    symlinkSync(join(tmp, "nowhere.md"), join(vault, "pm", "dangling.md"));
    symlinkSync("loop.md", join(vault, "pm", "loop.md"));
    await settlesNotFound(setup(), "pm/dangling.md");
    await settlesNotFound(setup(), "pm/loop.md");
    await settlesNotFound(setup(), "pm/cc-mobile/tasks/card.md/x.md");
  });
  test("T7 a link into an outside directory that cannot be searched is 404", async () => {
    const zdir = join(tmp, "outside", "zdir");
    mkdirSync(zdir, { recursive: true });
    writeFileSync(join(zdir, "secret.md"), "SENTINEL-OUTSIDE");
    chmodSync(zdir, 0);
    try {
      symlinkSync(zdir, join(vault, "pm", "lock"));
      await settlesNotFound(setup(), "pm/lock/secret.md");
    } finally {
      chmodSync(zdir, 0o755);
    }
  });
});

describe("LaunchRefusesNonClaudeKind", () => {
  const omp: AgentProfile = { id: "omp-x", label: "o", kind: "omp", args: [] };
  test("T1 a non-claude profile is refused with no effect", async () => {
    const s = setup({ profiles: [omp] });
    const r = await s.post({ ...good, profileId: "omp-x" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "unsupported_kind" });
    nothingHappened(s);
  });
  test("T2 the kind check precedes the cwd checks", async () => {
    const r = await setup({ profiles: [omp] }).post({
      ...good,
      cwd: "/definitely/not/here",
      profileId: "omp-x",
    });
    expect((await r.json()).error).toBe("unsupported_kind");
  });
  test("T3 an unknown profile falls through to unknown_profile", async () => {
    const s = setup();
    const r = await s.post({ ...good, profileId: "ghost" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("unknown_profile");
    nothingHappened(s);
  });
  test("T4 a claude profile launches", async () => {
    const r = await setup({ profiles: [claudeAuto] }).post({ ...good, profileId: "claude-auto" });
    expect(r.status).toBe(201);
  });
});

describe("LaunchCreatesOnHangar", () => {
  test("T1 create gets a fresh v4 uuid, the cwd and side hangar", async () => {
    const s = setup();
    await s.post(good);
    expect(s.creates).toHaveLength(1);
    const { claudeUuid, ...rest } = s.creates[0];
    expect(claudeUuid).toMatch(UUID_V4);
    expect(rest).toEqual({ cwd: "/tmp", side: "hangar" });
  });
  test("T2 a claude profile adds its kind and args", async () => {
    const s = setup({ profiles: [claudeAuto] });
    await s.post({ ...good, profileId: "claude-auto" });
    const { claudeUuid, ...rest } = s.creates[0];
    expect(claudeUuid).toMatch(UUID_V4);
    expect(rest).toEqual({
      cwd: "/tmp",
      agentKind: "claude",
      profileArgs: ["--permission-mode", "auto"],
      side: "hangar",
    });
  });
  test("T3 a rejecting create is terminal_error with no binding and nothing typed", async () => {
    const s = setup({ createError: "connect ENOENT" });
    const r = await s.post(good);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "terminal_error", message: "connect ENOENT" });
    expect(s.launches()).toEqual([]);
    expect(s.sends).toEqual([]);
  });
  test("T4 a bad cwd or a disallowed root creates nothing", async () => {
    const bad = setup();
    const r1 = await bad.post({ ...good, cwd: "/definitely/not/here" });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("invalid_cwd");
    nothingHappened(bad);
    const roots = setup({ allowedRoots: ["/nonexistent-root"] });
    const r2 = await roots.post(good);
    expect(r2.status).toBe(403);
    expect((await r2.json()).error).toBe("path_not_allowed");
    nothingHappened(roots);
  });
});

describe("LaunchReturnsClaudeUuid", () => {
  test("T1 the response names the session and the uuid given to create", async () => {
    const s = setup();
    const r = await s.post(good);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      sessionId: "fleet@w1:p2",
      claudeUuid: s.creates[0].claudeUuid,
    });
  });
  test("T2 two launches get different uuids", async () => {
    const s = setup();
    const a = await (await s.post(good)).json();
    const b = await (await s.post(good)).json();
    expect(a.claudeUuid).not.toBe(b.claudeUuid);
  });
  test("T3 a failing send is 502 carrying the uuid", async () => {
    const s = setup({ sendFails: true });
    const r = await s.post(good);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({
      error: "prompt_failed",
      sessionId: "fleet@w1:p2",
      claudeUuid: s.creates[0].claudeUuid,
    });
  });
});

describe("LaunchTypesComposedPrompt", () => {
  test("T1 exactly one send of the template plus the card as read", async () => {
    const s = setup();
    await s.post(good);
    expect(s.sends).toEqual([
      { claudeUuid: "fleet@w1:p2", content: composeLaunchPrompt(CARD), confirmStart: true },
    ]);
  });
  test("T2 the audit line carries only the six fields, no card text", async () => {
    const s = setup();
    await s.post(good);
    expect(s.audits).toEqual([
      {
        action: "prompt_send",
        paneId: "fleet@w1:p2",
        ip: "100.1.2.3",
        device: "launch-api",
        outcome: "dispatched",
      },
    ]);
    expect(JSON.stringify(s.audits)).not.toContain("CARD-BODY");
  });
});

describe("LaunchBindingBeforePrompt", () => {
  test("T1-T2 the binding exists when send is first called, with an ISO timestamp", async () => {
    const s = setup();
    await s.post(good);
    const text = s.bindingAtSend[0].text;
    expect(text).not.toBeNull();
    const binding = JSON.parse(text as string);
    expect(binding).toEqual({
      cardPath: "pm/cc-mobile/tasks/card.md",
      vault: "obsidian",
      project: "cc-mobile",
      paneId: "fleet@w1:p2",
      createdAt: binding.createdAt,
    });
    expect(new Date(binding.createdAt).toISOString()).toBe(binding.createdAt);
  });
  test("T3 a failed prompt leaves the binding in place", async () => {
    const s = setup({ sendFails: true });
    const r = await s.post(good);
    expect(r.status).toBe(502);
    expect(s.launches()).toEqual([`${s.creates[0].claudeUuid}.json`]);
  });
});

describe("LaunchBindingFailureAborts", () => {
  function unwritableLaunchesDir(teardownFails: boolean) {
    writeFileSync(join(tmp, "afile"), "x");
    return setup({ launchesDir: join(tmp, "afile", "sub"), teardownFails });
  }
  test("T1 a binding that cannot be written tears the pane down and types nothing", async () => {
    const s = unwritableLaunchesDir(false);
    const r = await s.post(good);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({
      error: "binding_failed",
      sessionId: "fleet@w1:p2",
      claudeUuid: s.creates[0].claudeUuid,
    });
    expect(s.calls).toEqual(["worktree:/tmp:card", "create:/tmp", "teardown:fleet@w1:p2"]);
    expect(s.audits).toEqual([]);
  });
  test("T2 a rejecting teardown does not change the response", async () => {
    const s = unwritableLaunchesDir(true);
    const r = await s.post(good);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({
      error: "binding_failed",
      sessionId: "fleet@w1:p2",
      claudeUuid: s.creates[0].claudeUuid,
    });
  });
});

describe("LaunchCardWorktree", () => {
  const worktree = {
    repo: "/repo",
    path: "/repo/.claude/worktrees/card",
    branch: "fleet/card",
    cwd: "/tmp",
  };
  const created: CardWorktreeResult = { kind: "created", ...worktree };
  test("W1 the pane starts in the card's worktree, named by the card's basename", async () => {
    const s = setup({ worktree: { ...created, cwd: tmp } });
    const r = await s.post(good);
    expect(r.status).toBe(201);
    expect(s.calls.slice(0, 2)).toEqual(["worktree:/tmp:card", `create:${tmp}`]);
  });
  test("W2 a cwd that is no repo launches in place", async () => {
    const s = setup();
    expect((await s.post(good)).status).toBe(201);
    expect(s.creates[0].cwd).toBe("/tmp");
  });
  test("W3 an existing branch or worktree is 409 with nothing created, bound or typed", async () => {
    const s = setup({
      worktree: { kind: "refused", code: "worktree_exists", message: "fleet/card exists" },
    });
    const r = await s.post(good);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "worktree_exists", message: "fleet/card exists" });
    expect(s.calls).toEqual(["worktree:/tmp:card"]);
    expect(s.launches()).toEqual([]);
    expect(s.audits).toEqual([]);
  });
  test("W4 each worktree refusal has its status, and nothing is created", async () => {
    for (const [code, status] of [
      ["path_not_allowed", 403],
      ["invalid_branch_name", 400],
      ["no_base_branch", 400],
      ["cwd_not_on_base", 400],
      ["worktree_failed", 500],
    ] as const) {
      const s = setup({ worktree: { kind: "refused", code, message: "m" } });
      const r = await s.post(good);
      expect([code, r.status]).toEqual([code, status]);
      expect(await r.json()).toEqual({ error: code, message: "m" });
      expect(s.creates).toEqual([]);
    }
  });
  test("W9 the worktree is asked with the cwd as sent and the allowed roots", async () => {
    const s = setup({ allowedRoots: ["/tmp", tmp] });
    await s.post({ ...good, cwd: "/tmp/" });
    expect(s.worktreeRequests).toEqual([
      { cwd: "/tmp/", cardName: "card", allowedRoots: ["/tmp", tmp] },
    ]);
  });
  test("W5 a refused session removes the worktree it was given", async () => {
    const s = setup({ worktree: created, createError: "connect ENOENT" });
    expect((await s.post(good)).status).toBe(500);
    expect(s.calls).toEqual(["worktree:/tmp:card", "create:/tmp", `remove:${worktree.path}`]);
  });
  test("W6 a failed binding tears the pane down and removes the worktree", async () => {
    writeFileSync(join(tmp, "afile"), "x");
    const s = setup({ worktree: created, launchesDir: join(tmp, "afile", "sub") });
    expect((await s.post(good)).status).toBe(500);
    expect(s.calls).toEqual([
      "worktree:/tmp:card",
      "create:/tmp",
      "teardown:fleet@w1:p2",
      `remove:${worktree.path}`,
    ]);
  });
  test("W7 a failed prompt keeps the worktree, as it keeps the binding", async () => {
    const s = setup({ worktree: created, sendFails: true });
    expect((await s.post(good)).status).toBe(502);
    expect(s.calls.some((c) => c.startsWith("remove:"))).toBe(false);
  });
  test("W8 a nested card path still names the worktree by its basename", async () => {
    mkdirSync(join(vault, "pm", "cc-mobile", "tasks", "sub"));
    writeFileSync(join(vault, "pm", "cc-mobile", "tasks", "sub", "x.y.md"), CARD);
    const s = setup();
    await s.post({ ...good, cardPath: "pm/cc-mobile/tasks/sub/x.y.md" });
    expect(s.calls[0]).toBe("worktree:/tmp:x.y");
  });
});

function card(name: string, text = CARD) {
  writeFileSync(join(vault, "pm", "cc-mobile", "tasks", name), text);
  return `pm/cc-mobile/tasks/${name}`;
}

/** A queue that is full: one slot, taken. */
function full(opts: SetupOptions = {}) {
  return setup({ cap: 1, occupancy: 1, ...opts });
}

const WRITES = ["worktree:/tmp:card", "create:/tmp", "send:fleet@w1:p2"];

describe("LaunchAdmittedWhenSlotFree", () => {
  test("T1 a free slot starts at once, reading occupancy once before the worktree", async () => {
    const s = setup({ cap: 4, occupancy: 3 });
    const r = await s.post(good);
    expect(r.status).toBe(201);
    const body = (await r.json()) as { sessionId: string; claudeUuid: string };
    expect(body.sessionId).toBe("fleet@w1:p2");
    expect(body.claudeUuid).toMatch(UUID_V4);
    expect(s.events).toEqual(["occupancy", ...WRITES]);
  });
  test("T4 a refused session creation answers today's 500", async () => {
    const s = setup({ cap: 4, occupancy: 3, createError: "boom" });
    const r = await s.post(good);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "terminal_error", message: "boom" });
  });
});

describe("LaunchChecksPrecedeQueue", () => {
  test("T1 a missing token is refused before the queue or occupancy is touched", async () => {
    const s = setup({ cap: 4, occupancy: 4 });
    const r = await s.post(good, null);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "unauthorized" });
    expect(s.occupancy.reads).toBe(0);
    nothingHappened(s);
    expect((await s.queue.status()).queued).toBe(0);
  });
  test("T2 a wrong token is 401 even when the card already waits", async () => {
    const s = full();
    expect((await s.post(good)).status).toBe(202);
    expect((await s.post(good, "Bearer nope")).status).toBe(401);
  });
  test("T3 an invalid body reads no occupancy", async () => {
    const s = setup({ occupancy: null });
    const r = await s.post({});
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_body" });
    expect(s.occupancy.reads).toBe(0);
  });
  test("T4 a bad card path is refused on a full hangar", async () => {
    const s = setup({ cap: 4, occupancy: 4 });
    const r = await s.post({ ...good, cardPath: "pm/../x.md" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_card_path" });
  });
  test("T5 an unknown profile is refused on a full hangar", async () => {
    const s = setup({ cap: 4, occupancy: 4 });
    const r = await s.post({ ...good, profileId: "nope" });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: "unknown_profile",
      message: "Unknown agent profile: nope",
    });
  });
  test("T6 a deleted card is 404 on a full hangar", async () => {
    const s = setup({ cap: 4, occupancy: 4 });
    rmSync(join(vault, good.cardPath));
    const r = await s.post(good);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "card_not_found" });
    expect(s.occupancy.reads).toBe(0);
  });
});

describe("LaunchQueuedWhenFull", () => {
  test("T1-T2 a full hangar answers 202 with a growing position and writes nothing", async () => {
    const s = setup({ cap: 4, occupancy: 4 });
    const r = await s.post(good);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ queued: true, position: 1 });
    nothingHappened(s);
    const positions: unknown[] = [];
    for (const name of ["b.md", "c.md", "d.md"]) {
      const res = await s.post({ ...good, cardPath: card(name) });
      positions.push(((await res.json()) as { position: number }).position);
    }
    expect(positions).toEqual([2, 3, 4]);
    nothingHappened(s);
  });
  test("T3 a free slot goes to the head of the line, not to a newcomer", async () => {
    let release!: () => void;
    const s = setup({
      cap: 2,
      occupancy: 2,
      holdSend: new Promise((resolve) => (release = () => resolve(null))),
    });
    const a = card("a.md");
    expect((await s.post({ ...good, cardPath: a })).status).toBe(202);
    s.occupancy.value = 1;
    const r = await s.post({ ...good, cardPath: card("d.md") });
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ queued: true, position: 1 });
    while (s.sends.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(s.worktreeRequests.map((w) => w.cardName)).toEqual(["a"]);
    release();
  });
});

describe("LaunchRefusedWhileHangarOffline", () => {
  test("T1 an unknown occupancy is 503 and nothing is queued", async () => {
    const s = setup({ occupancy: null });
    const r = await s.post(good);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "hangar_offline" });
    nothingHappened(s);
    expect((await s.queue.status()).queued).toBe(0);
  });
  test("T2 a rejecting occupancy source is 503", async () => {
    const s = setup({ occupancy: new Error("x") });
    const r = await s.post(good);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "hangar_offline" });
  });
  test("T3 a poll while offline starts nothing", async () => {
    const s = full();
    expect((await s.post(good)).status).toBe(202);
    s.occupancy.value = null;
    const b = card("b.md");
    expect((await s.post({ ...good, cardPath: b })).status).toBe(503);
    s.timers.set[0]();
    await new Promise((resolve) => setTimeout(resolve, 20));
    nothingHappened(s);
  });
});

describe("DuplicateCardRefused", () => {
  test("T1 the same card twice is 409 and the queue is unchanged", async () => {
    const s = full();
    expect((await s.post(good)).status).toBe(202);
    const r = await s.post(good);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "already_queued" });
    expect((await s.queue.status()).queued).toBe(1);
  });
  test("T2 two spellings of one path are one card", async () => {
    const s = full();
    expect((await s.post({ ...good, cardPath: "pm//cc-mobile/tasks/card.md" })).status).toBe(202);
    const r = await s.post({ ...good, cardPath: "pm/cc-mobile/tasks/./card.md" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "already_queued" });
  });
  test("T3 a card whose launch is still starting is 409", async () => {
    let release!: () => void;
    const s = setup({ holdSend: new Promise((resolve) => (release = () => resolve(null))) });
    const first = s.post(good);
    while (s.sends.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await s.post(good);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "already_queued" });
    release();
    expect((await first).status).toBe(201);
  });
  test("T4 a launch that failed outright is not remembered", async () => {
    const s = setup({ createError: "boom" });
    expect((await s.post(good)).status).toBe(500);
    expect((await s.post(good)).status).toBe(500);
  });
  test("T5 the duplicate check precedes the occupancy read", async () => {
    const s = full();
    expect((await s.post(good)).status).toBe(202);
    s.occupancy.value = null;
    expect((await s.post(good)).status).toBe(409);
  });
});

describe("DequeuedLaunchRunsTodaysWrites", () => {
  test("T1 a dequeued launch runs the same writes, attributed to the enqueuing request", async () => {
    const s = full();
    expect((await s.post(good, "Bearer s3cret", { "x-forwarded-for": "100.1.2.3" })).status).toBe(
      202,
    );
    nothingHappened(s);
    s.occupancy.value = 0;
    await s.tick();
    expect(s.calls).toEqual(WRITES);
    const files = s.launches();
    expect(files).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(s.launchesDir, files[0]), "utf8"))).toEqual({
      cardPath: "pm/cc-mobile/tasks/card.md",
      vault: "obsidian",
      project: "cc-mobile",
      paneId: "fleet@w1:p2",
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    expect(s.audits).toEqual([
      {
        action: "prompt_send",
        paneId: "fleet@w1:p2",
        ip: "100.1.2.3",
        device: "launch-api",
        outcome: "dispatched",
      },
    ]);
    expect(s.sends[0].confirmStart).toBe(true);
  });
  test("T2 the pane starts in the card's worktree on the hangar", async () => {
    const wt = join(tmp, "wt");
    mkdirSync(wt);
    const s = full({
      worktree: {
        kind: "created",
        repo: "/repo",
        path: "/repo/.claude/worktrees/card",
        branch: "fleet/card",
        cwd: wt,
      },
    });
    await s.post(good);
    s.occupancy.value = 0;
    await s.tick();
    expect(s.creates[0].cwd).toBe(wt);
    expect(s.creates[0].side).toBe("hangar");
  });
  test("T3 the binding exists before the prompt is typed", async () => {
    const s = full();
    await s.post(good);
    s.occupancy.value = 0;
    await s.tick();
    expect(s.bindingAtSend[0].text).not.toBeNull();
  });
});

describe("DequeuedLaunchReadsCardAtDequeue", () => {
  test("T1 the prompt typed is the card as it stands at dequeue", async () => {
    const s = full();
    expect((await s.post(good)).status).toBe(202);
    card("card.md", "# Task\nCARD-BODY v2\n");
    s.occupancy.value = 0;
    await s.tick();
    expect(s.sends[0].content).toBe(composeLaunchPrompt("# Task\nCARD-BODY v2\n"));
  });
  test("T2 the profile's argv is the one listed at dequeue", async () => {
    const s = full({ profiles: [claudeAuto] });
    expect((await s.post({ ...good, profileId: "claude-auto" })).status).toBe(202);
    s.opts.profiles = [{ ...claudeAuto, args: ["--permission-mode", "plan"] }];
    s.occupancy.value = 0;
    await s.tick();
    expect(s.creates[0].profileArgs).toEqual(["--permission-mode", "plan"]);
  });
});

describe("DequeueFailureFreesCard", () => {
  const created: CardWorktreeResult = {
    kind: "created",
    repo: "/repo",
    path: "/repo/.claude/worktrees/card",
    branch: "fleet/card",
    cwd: "/tmp",
  };
  const key = cardKey("obsidian", good.cardPath);

  test("T1 a refused worktree frees the card and removes nothing", async () => {
    const s = full();
    await s.post(good);
    s.opts.worktree = { kind: "refused", code: "worktree_exists", message: "taken" };
    s.occupancy.value = 0;
    await s.tick();
    expect(s.queue.has(key)).toBe(false);
    expect(s.calls.some((c) => c.startsWith("remove:"))).toBe(false);
    s.occupancy.value = 1;
    expect((await s.post(good)).status).not.toBe(409);
  });
  test("T2 a failed session creation removes the worktree it made and frees the card", async () => {
    const s = full({ worktree: created });
    await s.post(good);
    s.opts.createError = "boom";
    s.occupancy.value = 0;
    await s.tick();
    expect(s.calls).toContain(`remove:${created.path}`);
    expect(s.queue.has(key)).toBe(false);
    s.occupancy.value = 1;
    expect((await s.post(good)).status).not.toBe(409);
  });
  test("T3 a failed binding write tears the pane down, removes the worktree and frees the card", async () => {
    writeFileSync(join(tmp, "afile"), "x");
    const s = full({ worktree: created, launchesDir: join(tmp, "afile", "sub") });
    await s.post(good);
    s.occupancy.value = 0;
    await s.tick();
    expect(s.calls).toContain("teardown:fleet@w1:p2");
    expect(s.calls).toContain(`remove:${created.path}`);
    expect(s.queue.has(key)).toBe(false);
    s.occupancy.value = 1;
    expect((await s.post(good)).status).not.toBe(409);
  });
  test("T4 a card deleted while it waited frees the card, and a restored card can be dispatched", async () => {
    const s = full();
    await s.post(good);
    const path = join(vault, good.cardPath);
    rmSync(path);
    s.occupancy.value = 0;
    await s.tick();
    expect(s.queue.has(key)).toBe(false);
    writeFileSync(path, CARD);
    s.occupancy.value = 1;
    expect((await s.post(good)).status).not.toBe(409);
  });
});

describe("DequeueFailureLogsOnly", () => {
  test("T1 a card deleted while waiting leaves one log line and no write", async () => {
    const s = full();
    await s.post(good);
    rmSync(join(vault, good.cardPath));
    s.occupancy.value = 0;
    await s.tick();
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatch(/pm\/cc-mobile\/tasks\/card\.md/);
    expect(s.logs[0]).toMatch(/card_not_found/);
    expect(s.audits).toEqual([]);
    expect(s.calls).toEqual([]);
  });
  test("T2 a refused session creation logs terminal_error", async () => {
    const s = full();
    await s.post(good);
    s.opts.createError = "boom";
    s.occupancy.value = 0;
    await s.tick();
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatch(/terminal_error/);
    expect(s.audits).toEqual([]);
  });
  test("T3 a log line carries neither the token nor the card text", async () => {
    const lines: string[] = [];
    const first = full();
    await first.post(good);
    rmSync(join(vault, good.cardPath));
    first.occupancy.value = 0;
    await first.tick();
    lines.push(...first.logs);
    writeFileSync(join(vault, good.cardPath), CARD);
    const second = full();
    await second.post(good);
    second.opts.createError = "boom";
    second.occupancy.value = 0;
    await second.tick();
    lines.push(...second.logs);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain("s3cret");
      expect(line).not.toContain("CARD-BODY");
    }
  });
  test("T4 a launch admitted at once logs nothing when it fails", async () => {
    const s = setup({ createError: "boom" });
    expect((await s.post(good)).status).toBe(500);
    expect(s.logs).toHaveLength(0);
  });
});

describe("DequeuedPromptFailureKeepsBinding", () => {
  test("T1 an unconfirmed prompt keeps the pane and binding, audits failed and frees the card", async () => {
    const s = full();
    await s.post(good);
    s.opts.sendFails = true;
    s.occupancy.value = 0;
    await s.tick();
    expect(s.launches()).toHaveLength(1);
    expect(s.calls.some((c) => c.startsWith("remove:") || c.startsWith("teardown:"))).toBe(false);
    expect(s.audits).toEqual([
      {
        action: "prompt_send",
        paneId: "fleet@w1:p2",
        ip: "100.1.2.3",
        device: "launch-api",
        outcome: "failed",
      },
    ]);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toMatch(/prompt_failed/);
    expect(s.queue.has(cardKey("obsidian", good.cardPath))).toBe(false);
  });
});
