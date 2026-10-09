import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
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

function setup(opts: { createError?: string } = {}) {
  const creates: CreateSessionInput[] = [];
  let pane = 0;
  const app = createLaunchPlugin({
    config: {
      port: 0,
      hostname: "127.0.0.1",
      defaultCwd: null,
      allowedRoots: [tmp],
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
  const post = (card: string, cwd = repo) =>
    app.handle(
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
  return { creates, post };
}

const worktreePaths = () =>
  git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));

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
    const s = setup({ createError: "connect ENOENT" });
    expect((await s.post("card-a")).status).toBe(500);
    expect(worktreePaths()).toEqual([repo]);
    expect(git(repo, "branch", "--list", "fleet/*")).toBe("");
    expect(userCheckout()).toEqual(before);
  });

  test("a cwd that is no repo launches in place", async () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    const s = setup();
    expect((await s.post("card-a", plain)).status).toBe(201);
    expect(s.creates[0].cwd).toBe(plain);
  });
});
