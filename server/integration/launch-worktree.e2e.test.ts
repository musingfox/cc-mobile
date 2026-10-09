import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyAgentProfileSource } from "../agents/profiles";
import { EventBuffer } from "../event-buffer";
import { createLaunchPlugin } from "../launch";
import { gitCardWorktrees } from "../launch-worktree";
import type { CreateSessionInput } from "../terminal-backend";

/**
 * LaunchCardWorktreeOnRealGit — each card gets its own worktree, and the
 * user's checkout does not notice.
 *
 * Out of the commit gate because it spawns `git`, which the unit tier may not
 * (docs/spec/test-tier-by-dependency.md). The herdr backend is a stub: what
 * this proves is the git side and the cwd handed to `createSession`; that a
 * real pane then runs there is herdr's `workspace.create` honouring its cwd.
 *
 *   bun --config=/dev/null test ./server/integration/launch-worktree.e2e.test.ts
 */

const OBW = "vault: obsidian\npm:\n  project: demo\n";

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

let tmp: string;
let repo: string;
let vault: string;
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "launch-worktree-")));
  repo = join(tmp, "demo");
  vault = join(tmp, "obsidian");
  mkdirSync(join(repo, "sub"), { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  // The repo ignores .obsidian.yaml, as cc-mobile does, but not .claude/.
  writeFileSync(join(repo, ".gitignore"), ".obsidian.yaml\n");
  writeFileSync(join(repo, "sub", "file.txt"), "tracked\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "chore: init");
  // The user is mid-feature, with uncommitted work, in their own checkout.
  git(repo, "checkout", "-q", "-b", "feat");
  writeFileSync(join(repo, "wip.txt"), "uncommitted\n");
  writeFileSync(join(repo, ".obsidian.yaml"), OBW);
  for (const name of ["card-a", "card-b"]) {
    mkdirSync(join(vault, "pm", "demo", "tasks"), { recursive: true });
    writeFileSync(join(vault, "pm", "demo", "tasks", `${name}.md`), `# ${name}\n`);
  }
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function setup(opts: { createError?: string; allowedRoots?: string[] } = {}) {
  const creates: CreateSessionInput[] = [];
  let pane = 0;
  const app = createLaunchPlugin({
    config: {
      port: 0,
      hostname: "127.0.0.1",
      defaultCwd: null,
      allowedRoots: opts.allowedRoots ?? [tmp],
      pushScope: "phone-last",
      basePath: "",
      launchToken: "tok",
      hangarSession: "fleet",
      vaultRoot: vault,
    },
    backend: {
      createSession: async (input: CreateSessionInput) => {
        creates.push(input);
        if (opts.createError) throw new Error(opts.createError);
        return { name: "t", paneRef: `fleet@w${++pane}:p1` };
      },
      teardown: async () => ({ killed: true }),
      registerClient: () => {},
      send: async () => {},
    },
    agentProfiles: emptyAgentProfileSource(),
    eventBuffer: new EventBuffer(10),
    launchesDir: join(tmp, "launches"),
    worktrees: gitCardWorktrees(),
  });
  const post = (card: string, cwd = repo) => {
    writeFileSync(join(vault, "pm", "demo", "tasks", `${card}.md`), `# ${card}\n`);
    return app.handle(
      new Request("http://localhost/api/launch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer tok" },
        body: JSON.stringify({
          cwd,
          cardPath: `pm/demo/tasks/${card}.md`,
          vault: "obsidian",
          project: "demo",
        }),
      }),
    );
  };
  return { creates, post };
}

const worktreePaths = () =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

const fleetBranches = () => git(repo, "branch", "--list", "fleet/*").trim();
const excludeLines = () =>
  readFileSync(join(repo, ".git", "info", "exclude"), "utf8")
    .split("\n")
    .filter((line) => line === "/.claude/worktrees/").length;
const adminEntries = () =>
  existsSync(join(repo, ".git", "worktrees")) ? readdirSync(join(repo, ".git", "worktrees")) : [];

/** A refused launch: no session, no worktree, no branch, no admin entry, no exclude line. */
function leftNothing(s: ReturnType<typeof setup>) {
  expect(s.creates).toEqual([]);
  expect(worktreePaths()).toEqual([repo]);
  expect(fleetBranches()).toBe("");
  expect(adminEntries()).toEqual([]);
  const worktrees = join(repo, ".claude", "worktrees");
  expect(existsSync(worktrees) ? readdirSync(worktrees) : []).toEqual([]);
  expect(excludeLines()).toBe(0);
}

const userCheckout = () => ({
  status: git(repo, "status", "--porcelain=v1", "--untracked-files=all"),
  head: git(repo, "rev-parse", "HEAD"),
  branch: git(repo, "branch", "--show-current"),
});

describe("LaunchCardWorktreeOnRealGit", () => {
  test("AC1-AC3 two cards on one repo get two worktrees and the checkout is unchanged", async () => {
    const before = userCheckout();
    const s = setup();
    const a = await s.post("card-a");
    const b = await s.post("card-b");
    expect([a.status, b.status]).toEqual([201, 201]);

    const wa = join(repo, ".claude", "worktrees", "card-a");
    const wb = join(repo, ".claude", "worktrees", "card-b");
    expect(worktreePaths()).toEqual([repo, wa, wb]);
    expect(s.creates.map((c) => c.cwd)).toEqual([wa, wb]);
    expect(git(wa, "branch", "--show-current").trim()).toBe("fleet/card-a");
    expect(git(wb, "branch", "--show-current").trim()).toBe("fleet/card-b");
    // Based on main, not on the branch the user happens to have checked out.
    expect(git(wa, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "main"));
    expect(existsSync(join(wa, "wip.txt"))).toBe(false);

    expect(userCheckout()).toEqual(before);

    expect(readFileSync(join(wa, ".obsidian.yaml"), "utf8")).toBe(OBW);
    expect(readFileSync(join(wb, ".obsidian.yaml"), "utf8")).toBe(OBW);
    expect(git(wa, "status", "--porcelain")).toBe("");
    expect(excludeLines()).toBe(1);
  });

  test("dispatching a card twice is 409 and leaves one worktree", async () => {
    const s = setup();
    expect((await s.post("card-a")).status).toBe(201);
    const again = await s.post("card-a");
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("worktree_exists");
    expect(worktreePaths()).toHaveLength(2);
    expect(s.creates).toHaveLength(1);
  });

  test("a cwd inside the repo maps to the same directory inside the worktree", async () => {
    const s = setup();
    expect((await s.post("card-a", join(repo, "sub"))).status).toBe(201);
    expect(s.creates[0].cwd).toBe(join(repo, ".claude", "worktrees", "card-a", "sub"));
  });

  test("a refused session removes the worktree and its branch", async () => {
    const before = userCheckout();
    // Debris the user already had: no gitdir, no lock. It is not this launch's to drop.
    mkdirSync(join(repo, ".git", "worktrees", "stale"), { recursive: true });
    const s = setup({ createError: "connect ENOENT" });
    expect((await s.post("card-a")).status).toBe(500);
    expect(worktreePaths()).toEqual([repo]);
    expect(git(repo, "branch", "--list", "fleet/*")).toBe("");
    expect(adminEntries()).toEqual(["stale"]);
    expect(userCheckout()).toEqual(before);
  });

  test("a cwd that is no repo launches in place", async () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    const s = setup();
    expect((await s.post("card-a", plain)).status).toBe(201);
    expect(s.creates[0].cwd).toBe(plain);
  });
  test("an allowed root narrower than the repo is 403 before git writes anything", async () => {
    const before = userCheckout();
    const s = setup({ allowedRoots: [join(repo, "sub")] });
    const r = await s.post("card-a", join(repo, "sub"));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("path_not_allowed");
    leftNothing(s);
    expect(userCheckout()).toEqual(before);
  });

  // A failed checkout deletes only the branch it made, and never a directory
  // or an admin entry: "did this launch make it?" was answered wrongly in
  // three review rounds, each time at the user's expense.
  const checkoutFailure = async (r: Response) => {
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.error).toBe("worktree_failed");
    expect(body.message).toContain(
      `May be left for recycling: ${join(repo, ".claude", "worktrees")}`,
    );
    return body.message as string;
  };

  test("a checkout git cannot finish deletes its branch and names what may remain", async () => {
    const s = setup();
    // `@` passes check-ref-format, then git cannot find the worktree it made.
    await checkoutFailure(await s.post("@"));
    expect(fleetBranches()).toBe("");
    expect(s.creates).toEqual([]);
    expect((await s.post("@")).status).toBe(500);
  });

  for (const relative of [false, true]) {
    test(`a failing post-checkout hook leaves the checkout and its branch, and says so${relative ? " (relative paths)" : ""}`, async () => {
      if (relative) git(repo, "config", "worktree.useRelativePaths", "true");
      mkdirSync(join(repo, ".hooks"));
      writeFileSync(join(repo, ".hooks", "post-checkout"), "#!/bin/sh\nexit 1\n");
      chmodSync(join(repo, ".hooks", "post-checkout"), 0o755);
      git(repo, "config", "core.hooksPath", ".hooks");
      const s = setup();
      const message = await checkoutFailure(await s.post("card-a"));
      // git refuses to delete a branch a worktree has checked out, and is not overridden.
      expect(message).toContain("branch fleet/card-a kept");
      const at = join(repo, ".claude", "worktrees", "card-a");
      expect(worktreePaths()).toEqual([repo, at]);
      expect(fleetBranches()).toBe("+ fleet/card-a");
      expect(s.creates).toEqual([]);
      git(repo, "config", "--unset", "core.hooksPath");
      expect((await s.post("card-a")).status).toBe(409);
    });
  }

  test("a worktree someone else makes at the card's path mid-checkout survives intact", async () => {
    // A git shim on PATH plays the other actor, just before this launch's own add.
    const real = Bun.which("git") as string;
    const shim = join(tmp, "shim");
    mkdirSync(shim);
    writeFileSync(
      join(shim, "git"),
      `#!/bin/bash\nif [ "$3" = worktree ] && [ "$4" = add ] && [ "$6" = fleet/card-a ]; then "${real}" -C "$2" worktree add -q -b theirs "$5" main >/dev/null 2>&1; echo mine > "$5/staged.txt"; "${real}" -C "$5" add staged.txt; fi\nexec "${real}" "$@"\n`,
    );
    chmodSync(join(shim, "git"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${shim}:${path}`;
    try {
      const s = setup();
      await checkoutFailure(await s.post("card-a"));
    } finally {
      process.env.PATH = path;
    }
    const at = join(repo, ".claude", "worktrees", "card-a");
    expect(git(at, "status", "--porcelain")).toBe("A  staged.txt\n");
    expect(git(at, "branch", "--show-current").trim()).toBe("theirs");
    expect(fleetBranches()).toBe("");
  });

  test("concurrent launches: one card wins once, and the exclude line is written once", async () => {
    const s = setup();
    const statuses = (await Promise.all([s.post("card-a"), s.post("card-a"), s.post("card-b")]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([201, 201, 409]);
    expect(worktreePaths()).toHaveLength(3);
    expect(
      fleetBranches()
        .split("\n")
        .map((b) => b.trim()),
    ).toEqual(["+ fleet/card-a", "+ fleet/card-b"]);
    expect(excludeLines()).toBe(1);
  });

  describe("the base branch", () => {
    const commitOn = (branch: string) => {
      git(repo, "branch", branch, "main");
      const tree = git(repo, "rev-parse", "main^{tree}").trim();
      const commit = git(
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit-tree",
        tree,
        "-p",
        branch,
        "-m",
        "chore: x",
      ).trim();
      git(repo, "update-ref", `refs/heads/${branch}`, commit);
      return commit;
    };
    const baseOf = async (s: ReturnType<typeof setup>) => {
      expect((await s.post("card-a")).status).toBe(201);
      return git(join(repo, ".claude", "worktrees", "card-a"), "rev-parse", "HEAD").trim();
    };
    test("is the local branch origin/HEAD names first", async () => {
      const dev = commitOn("dev");
      git(repo, "config", "init.defaultBranch", "main");
      git(repo, "update-ref", "refs/remotes/origin/dev", dev);
      git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/dev");
      expect(await baseOf(setup())).toBe(dev);
    });
    test("then init.defaultBranch", async () => {
      const dev = commitOn("dev");
      git(repo, "config", "init.defaultBranch", "dev");
      expect(await baseOf(setup())).toBe(dev);
    });
    test("then main, then master", async () => {
      git(repo, "config", "init.defaultBranch", "nope");
      git(repo, "branch", "-m", "main", "master");
      expect(await baseOf(setup())).toBe(git(repo, "rev-parse", "master").trim());
    });
    test("none of them is a 400 naming what was tried", async () => {
      git(repo, "config", "init.defaultBranch", "nope");
      git(repo, "branch", "-m", "main", "trunk");
      const s = setup();
      const r = await s.post("card-a");
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.error).toBe("no_base_branch");
      expect(body.message).toContain("nope, main, master");
      leftNothing(s);
    });
  });

  test("a cwd the base branch does not have is refused, quoting the cwd sent", async () => {
    mkdirSync(join(repo, "newpkg"));
    writeFileSync(join(repo, "newpkg", "x.txt"), "only on the user's disk\n");
    const s = setup();
    const cwd = join(repo, "newpkg");
    const r = await s.post("card-a", cwd);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("cwd_not_on_base");
    expect(body.message).toContain(cwd);
    expect(body.message).not.toContain(".claude/worktrees");
    leftNothing(s);
  });

  test("a repo git refuses to read is worktree_failed, never a launch in place", async () => {
    const broken = join(tmp, "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, ".git"), "gitdir: /nonexistent\n");
    const s = setup();
    const r = await s.post("card-a", broken);
    expect(r.status).toBe(500);
    expect((await r.json()).error).toBe("worktree_failed");
    const inside = await s.post("card-b", join(repo, ".git"));
    expect(inside.status).toBe(500);
    expect(s.creates).toEqual([]);
  });
  describe("something the user owns at the card's path", () => {
    const at = () => join(repo, ".claude", "worktrees", "card-a");
    test("a registered worktree whose directory is absent is 409, and survives intact", async () => {
      git(repo, "worktree", "add", "-q", "-b", "users-own", at(), "main");
      writeFileSync(join(at(), "staged.txt"), "mine\n");
      git(at(), "add", "staged.txt");
      const away = join(tmp, "unmounted");
      renameSync(at(), away);
      const admin = adminEntries();
      const s = setup();
      const r = await s.post("card-a");
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe("worktree_exists");
      expect(s.creates).toEqual([]);
      expect(fleetBranches()).toBe("");
      expect(adminEntries()).toEqual(admin);
      renameSync(away, at());
      expect(git(at(), "status", "--porcelain")).toBe("A  staged.txt\n");
    });
    test("a dangling symlink is 409, and is left in place", async () => {
      mkdirSync(join(repo, ".claude", "worktrees"), { recursive: true });
      symlinkSync(join(tmp, "absent-volume"), at());
      const s = setup();
      const r = await s.post("card-a");
      expect(r.status).toBe(409);
      expect(lstatSync(at()).isSymbolicLink()).toBe(true);
      expect(fleetBranches()).toBe("");
      expect(adminEntries()).toEqual([]);
    });
  });

  test("a worktrees directory the server cannot search is 500 before git writes", async () => {
    const parent = join(repo, ".claude", "worktrees");
    mkdirSync(parent, { recursive: true });
    chmodSync(parent, 0o000);
    try {
      const s = setup();
      const r = await s.post("card-a");
      expect(r.status).toBe(500);
      expect((await r.json()).error).toBe("worktree_failed");
      expect(fleetBranches()).toBe("");
      expect(adminEntries()).toEqual([]);
    } finally {
      chmodSync(parent, 0o755);
    }
  });

  test("a repo whose name ends in a space gets the worktree, not its namesake beside it", async () => {
    const spaced = join(tmp, "demo ");
    mkdirSync(spaced);
    git(spaced, "init", "-q", "-b", "main");
    writeFileSync(join(spaced, "f.txt"), "x\n");
    git(spaced, "add", ".");
    git(spaced, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "chore: init");
    const s = setup();
    expect((await s.post("card-a", spaced)).status).toBe(201);
    expect(s.creates[0].cwd).toBe(join(spaced, ".claude", "worktrees", "card-a"));
    expect(git(spaced, "branch", "--list", "fleet/*").trim()).toBe("+ fleet/card-a");
    expect(fleetBranches()).toBe("");
    expect(worktreePaths()).toEqual([repo]);
  });

  test("a symlinked worktrees directory pointing outside the allowed roots is 403", async () => {
    const outside = join(tmp, "outside");
    mkdirSync(outside);
    mkdirSync(join(repo, ".claude"));
    symlinkSync(outside, join(repo, ".claude", "worktrees"));
    const s = setup({ allowedRoots: [repo] });
    const r = await s.post("card-a");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("path_not_allowed");
    expect(readdirSync(outside)).toEqual([]);
    expect(fleetBranches()).toBe("");
    expect(excludeLines()).toBe(0);
  });
  test("a cwd whose place in the repo git cannot report is worktree_failed, not the root", async () => {
    // A git shim on PATH fails `rev-parse --show-prefix` alone.
    const real = Bun.which("git") as string;
    const shim = join(tmp, "shim");
    mkdirSync(shim);
    writeFileSync(
      join(shim, "git"),
      `#!/bin/bash\nif [ "$3" = rev-parse ] && [ "$4" = --show-prefix ]; then echo "fatal: prefix unavailable" >&2; exit 128; fi\nexec "${real}" "$@"\n`,
    );
    chmodSync(join(shim, "git"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${shim}:${path}`;
    try {
      const s = setup();
      const r = await s.post("card-a", join(repo, "sub"));
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({
        error: "worktree_failed",
        message: "fatal: prefix unavailable",
      });
      expect(s.creates).toEqual([]);
    } finally {
      process.env.PATH = path;
    }
    expect(fleetBranches()).toBe("");
    expect(worktreePaths()).toEqual([repo]);
  });
});
