import { constants, existsSync } from "node:fs";
import { appendFile, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Where a card's worktree lives; also what `git worktree remove` is handed. */
export interface CardWorktree {
  repo: string;
  path: string;
  branch: string;
  /** The launch cwd mapped into the worktree: `path` plus the cwd's prefix inside the repo. */
  cwd: string;
}

export type CardWorktreeRefusal = "invalid_branch_name" | "worktree_exists" | "worktree_failed";

export type CardWorktreeResult =
  | { kind: "not_a_repo" }
  | ({ kind: "created" } & CardWorktree)
  | { kind: "refused"; code: CardWorktreeRefusal; message: string };

export interface CardWorktrees {
  create(cwd: string, cardName: string): Promise<CardWorktreeResult>;
  /** Best effort: undoes a `created` whose launch then failed. Never throws. */
  remove(worktree: CardWorktree): Promise<void>;
}

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

/** The local branch `origin/HEAD` names, else `main` — never the checkout's HEAD, which may be mid-feature. */
async function baseBranch(repo: string): Promise<string> {
  const head = await git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return head.ok && head.out.includes("/") ? head.out.slice(head.out.indexOf("/") + 1) : "main";
}

/**
 * A repo that does not ignore `.claude/worktrees/` would show the new worktree
 * as untracked in the user's own checkout. `info/exclude` hides it without
 * touching any tracked file.
 */
async function ensureIgnored(repo: string, path: string): Promise<void> {
  if ((await git(repo, ["check-ignore", "-q", path])).ok) return;
  const common = await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) throw new Error(common.err);
  await mkdir(join(common.out, "info"), { recursive: true });
  await appendFile(join(common.out, "info", "exclude"), "\n/.claude/worktrees/\n");
}

export function gitCardWorktrees(): CardWorktrees {
  const remove = async ({ repo, path, branch }: CardWorktree) => {
    await git(repo, ["worktree", "remove", "--force", path]).catch(() => {});
    await git(repo, ["branch", "-D", branch]).catch(() => {});
  };
  const create = async (cwd: string, cardName: string): Promise<CardWorktreeResult> => {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    if (!top.ok) return { kind: "not_a_repo" };
    const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).out;
    const repo = top.out;
    const branch = `fleet/${cardName}`;
    const path = join(repo, ".claude", "worktrees", cardName);
    const refused = (code: CardWorktreeRefusal, message: string) =>
      ({ kind: "refused", code, message }) as const;
    if (!(await git(repo, ["check-ref-format", "--branch", branch])).ok) {
      return refused("invalid_branch_name", `Not a valid branch name: ${branch}`);
    }
    const branchExists = (
      await git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
    ).ok;
    if (branchExists || existsSync(path)) {
      return refused("worktree_exists", `${branch} or ${path} already exists`);
    }
    try {
      await ensureIgnored(repo, path);
    } catch (error) {
      return refused("worktree_failed", String(error));
    }
    const added = await git(repo, ["worktree", "add", "-b", branch, path, await baseBranch(repo)]);
    if (!added.ok) {
      // Two launches of one card can both pass the checks above; git refuses the second.
      const code = added.err.includes("already exists") ? "worktree_exists" : "worktree_failed";
      return refused(code, added.err);
    }
    const created = { repo, path, branch, cwd: join(path, prefix) };
    // `.obsidian.yaml` is usually ignored, so the checkout lacks it, and the
    // obw skill reads it from the cwd.
    const config = join(repo, ".obsidian.yaml");
    try {
      if (existsSync(config)) {
        await copyFile(config, join(path, ".obsidian.yaml"), constants.COPYFILE_EXCL);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await remove(created);
        return refused("worktree_failed", String(error));
      }
    }
    return { kind: "created", ...created };
  };
  return {
    remove,
    // A spawn that throws (no `git` on PATH) must not launch in place as if the cwd were no repo.
    create: (cwd, cardName) =>
      create(cwd, cardName).catch((error) => ({
        kind: "refused",
        code: "worktree_failed",
        message: String(error),
      })),
  };
}
