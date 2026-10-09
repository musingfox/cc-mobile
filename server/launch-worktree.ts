import { constants, existsSync } from "node:fs";
import { appendFile, copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expandPath, validateAllowedPath } from "./path-utils";

/** Where a card's worktree lives; also what `git worktree remove` is handed. */
export interface CardWorktree {
  repo: string;
  path: string;
  branch: string;
  /** The launch cwd mapped into the worktree: `path` plus the cwd's prefix inside the repo. */
  cwd: string;
}

export type CardWorktreeRefusal =
  | "path_not_allowed"
  | "invalid_branch_name"
  | "worktree_exists"
  | "no_base_branch"
  | "cwd_not_on_base"
  | "worktree_failed";

export type CardWorktreeResult =
  | { kind: "not_a_repo" }
  | ({ kind: "created" } & CardWorktree)
  | { kind: "refused"; code: CardWorktreeRefusal; message: string };

export interface CardWorktreeRequest {
  /** The cwd as the client sent it; refusal messages quote it verbatim. */
  cwd: string;
  cardName: string;
  allowedRoots: string[] | null;
}

export interface CardWorktrees {
  create(request: CardWorktreeRequest): Promise<CardWorktreeResult>;
  /** Best effort: undoes a `created` whose launch then failed. Never throws. */
  remove(worktree: CardWorktree): Promise<void>;
}

const EXCLUDE_LINE = "/.claude/worktrees/";

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; out: string; err: string }> {
  // LC_ALL=C: the not-a-repo test below reads git's stderr, which gettext would translate.
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C" },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

const branchExists = async (repo: string, name: string) =>
  (await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`])).ok;

/**
 * The first local branch among what `origin/HEAD` names, `init.defaultBranch`,
 * `main` and `master` — never the checkout's HEAD, which may be mid-feature.
 */
async function baseBranch(repo: string): Promise<{ name: string } | { tried: string[] }> {
  const head = await git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const initDefault = await git(repo, ["config", "--get", "init.defaultBranch"]);
  const tried = [
    head.ok && head.out.includes("/") ? head.out.slice(head.out.indexOf("/") + 1) : "",
    initDefault.ok ? initDefault.out : "",
    "main",
    "master",
  ].filter((name, i, all) => name !== "" && all.indexOf(name) === i);
  for (const name of tried) {
    if (await branchExists(repo, name)) return { name };
  }
  return { tried };
}

// One queue for every repo: concurrent launches each passed `check-ignore`
// before any of them appended, and wrote the line once each.
let excludeQueue: Promise<unknown> = Promise.resolve();

/**
 * A repo that does not ignore `.claude/worktrees/` would show the new worktree
 * as untracked in the user's own checkout. `info/exclude` hides it without
 * touching any tracked file.
 */
async function ensureIgnored(repo: string, path: string): Promise<void> {
  if ((await git(repo, ["check-ignore", "-q", path])).ok) return;
  const common = await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) throw new Error(common.err);
  const file = join(common.out, "info", "exclude");
  const append = async () => {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.split("\n").includes(EXCLUDE_LINE)) return;
    await mkdir(join(common.out, "info"), { recursive: true });
    await appendFile(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}${EXCLUDE_LINE}\n`);
  };
  const run = excludeQueue.then(append, append);
  excludeQueue = run.catch(() => {});
  await run;
}

const adminDir = async (repo: string) => {
  const common = await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) throw new Error(common.err);
  return join(common.out, "worktrees");
};
const adminEntries = async (repo: string) =>
  new Set(await readdir(await adminDir(repo)).catch(() => []));

/**
 * Removes what one launch made: its branch, and — when `ownsPath` — its
 * checkout and the admin entry git left for it. Scoped to that entry rather
 * than `git worktree prune`, which would also drop the user's own worktrees
 * whose directory is merely absent right now (an unmounted disk). The entry is
 * one that appeared after `before` and either points at `path` or was never
 * finished (no `gitdir`, and no `locked` — git holds that while another add
 * is initializing).
 */
async function discard(
  repo: string,
  path: string,
  branch: string,
  ownsPath: boolean,
  before: Set<string> = new Set(),
) {
  try {
    if (ownsPath) {
      await git(repo, ["worktree", "remove", "--force", path]);
      await rm(path, { recursive: true, force: true });
      const admin = await adminDir(repo);
      for (const id of await adminEntries(repo)) {
        if (before.has(id)) continue;
        const entry = join(admin, id);
        const gitdir = await readFile(join(entry, "gitdir"), "utf8").catch(() => null);
        const unfinished = gitdir === null && !existsSync(join(entry, "locked"));
        if (unfinished || gitdir?.trim() === join(path, ".git")) {
          await rm(entry, { recursive: true, force: true });
        }
      }
    }
    await git(repo, ["branch", "-D", branch]);
  } catch {}
}

async function create({
  cwd,
  cardName,
  allowedRoots,
}: CardWorktreeRequest): Promise<CardWorktreeResult> {
  const refused = (code: CardWorktreeRefusal, message: string) =>
    ({ kind: "refused", code, message }) as const;
  const at = expandPath(cwd);

  // Reads only, up to `git branch`: a refusal before it leaves the repo as it was.
  const top = await git(at, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    // Only git's own "no repo here" launches in place. A repo git refuses to
    // read (dubious ownership, a broken .git) must not quietly lose isolation.
    return /not a git repository \(or any (of the )?parent/.test(top.err)
      ? { kind: "not_a_repo" }
      : refused("worktree_failed", top.err);
  }
  const repo = top.out;
  if (!validateAllowedPath(repo, allowedRoots)) {
    return refused(
      "path_not_allowed",
      `The repo ${repo} that ${cwd} belongs to is not in the allowed roots`,
    );
  }
  const prefix = (await git(at, ["rev-parse", "--show-prefix"])).out;
  const branch = `fleet/${cardName}`;
  const path = join(repo, ".claude", "worktrees", cardName);
  if (!(await git(repo, ["check-ref-format", "--branch", branch])).ok) {
    return refused("invalid_branch_name", `Not a valid branch name: ${branch}`);
  }
  if ((await branchExists(repo, branch)) || existsSync(path)) {
    return refused("worktree_exists", `${branch} or ${path} already exists`);
  }
  const base = await baseBranch(repo);
  if (!("name" in base)) {
    return refused(
      "no_base_branch",
      `No base branch for ${repo}: none of ${base.tried.join(", ")} exists locally`,
    );
  }
  if (prefix !== "") {
    const kind = await git(repo, ["cat-file", "-t", `${base.name}:${prefix.replace(/\/$/, "")}`]);
    if (kind.out !== "tree") {
      return refused("cwd_not_on_base", `${cwd} does not exist on the base branch ${base.name}`);
    }
  }

  // `git branch` creates the ref atomically, so from here on the branch is this
  // launch's own; a concurrent launch of the same card fails here and owns nothing.
  const branched = await git(repo, ["branch", branch, base.name]);
  if (!branched.ok) {
    const code = branched.err.includes("already exists") ? "worktree_exists" : "worktree_failed";
    return refused(code, branched.err);
  }
  const pathTaken = existsSync(path);
  const before = await adminEntries(repo);
  const added = await git(repo, ["worktree", "add", path, branch]);
  if (!added.ok) {
    await discard(repo, path, branch, !pathTaken, before);
    return refused(pathTaken ? "worktree_exists" : "worktree_failed", added.err);
  }
  try {
    await ensureIgnored(repo, path);
    // `.obsidian.yaml` is usually ignored, so the checkout lacks it, and the
    // obw skill reads it from the cwd.
    const config = join(repo, ".obsidian.yaml");
    if (existsSync(config) && !existsSync(join(path, ".obsidian.yaml"))) {
      await copyFile(config, join(path, ".obsidian.yaml"), constants.COPYFILE_EXCL);
    }
  } catch (error) {
    await discard(repo, path, branch, true);
    return refused("worktree_failed", String(error));
  }
  return { kind: "created", repo, path, branch, cwd: join(path, prefix) };
}

export function gitCardWorktrees(): CardWorktrees {
  return {
    remove: ({ repo, path, branch }) => discard(repo, path, branch, true),
    // A spawn that throws (no `git` on PATH) must not launch in place as if the cwd were no repo.
    create: (request) =>
      create(request).catch((error) => ({
        kind: "refused",
        code: "worktree_failed",
        message: String(error),
      })),
  };
}
