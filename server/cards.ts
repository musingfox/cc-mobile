import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Elysia } from "elysia";
import type { ServerConfig } from "./config";
import { resolveByLstat } from "./launch";
import { isWithinRoot } from "./path-utils";

export interface Card {
  /** Vault-relative, the form `POST /api/launch` takes as `cardPath`. */
  cardPath: string;
  title: string | null;
  status: string | null;
  priority: string | null;
  blockedBy: string[];
  dispatchable: boolean;
}

export interface CardProject {
  vault: string;
  project: string;
  /** Every repo whose `.obsidian.yaml` names this project; the dispatcher picks one. */
  repos: string[];
  cards: Card[];
}

export interface CardsReply {
  projects: CardProject[];
  skipped: { repo: string; reason: "invalid_config" | "vault_not_found" | "tasks_outside_vault" }[];
}

export interface CardSources {
  /** Its direct children are the repos scanned for `.obsidian.yaml`. */
  workspaceRoot: string;
  /** Obsidian's own vault registry, the only source of a vault's path. */
  obsidianConfigPath: string;
  /** Binding files written by `/api/launch` and obw's bind hook. */
  launchesDir: string;
}

/** The same rule `/api/launch` applies, since the name becomes a path component. */
const PROJECT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export function defaultObsidianConfigPath(home: string = homedir()): string {
  return process.platform === "darwin"
    ? join(home, "Library", "Application Support", "obsidian", "obsidian.json")
    : join(home, ".config", "obsidian", "obsidian.json");
}

export function defaultWorkspaceRoot(home: string = homedir()): string {
  return join(home, "workspace");
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parseYaml(source: string): unknown {
  try {
    return Bun.YAML.parse(source);
  } catch {
    return null;
  }
}

function frontmatter(source: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  return (match && record(parseYaml(match[1]))) ?? {};
}

/** Obsidian names a vault by its folder; `obsidian.json` stores only paths. */
async function vaultPaths(configPath: string): Promise<Map<string, string>> {
  const raw = await readOrNull(configPath);
  const vaults = raw === null ? null : record(record(JSON.parse(raw))?.vaults);
  const byName = new Map<string, string>();
  for (const entry of Object.values(vaults ?? {})) {
    const path = text(record(entry)?.path);
    if (path) byName.set(basename(path), path);
  }
  return byName;
}

/** `vault\0cardPath` of every card a launch has already bound. */
async function boundCards(dir: string): Promise<Set<string>> {
  const bound = new Set<string>();
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const raw = await readOrNull(join(dir, name));
    let binding: Record<string, unknown> | null = null;
    try {
      binding = raw === null ? null : record(JSON.parse(raw));
    } catch {}
    const vault = text(binding?.vault);
    const cardPath = text(binding?.cardPath);
    if (vault && cardPath) bound.add(`${vault}\0${cardPath}`);
  }
  return bound;
}

function blockers(v: unknown): string[] {
  return (Array.isArray(v) ? v : [v])
    .filter((x) => x !== null && x !== undefined && x !== "")
    .map(String);
}

/**
 * The tasks folder's real path: `null` when it does not resolve, `"outside"`
 * when a symlink anywhere above it leads out of the vault, where
 * `/api/launch` would refuse every card with `card_not_allowed`.
 */
async function resolveTasksDir(vaultPath: string, root: string | null, project: string) {
  if (root === null) return null;
  try {
    const tasks = (await resolveByLstat(join(vaultPath, "pm", project, "tasks"))).path;
    return isWithinRoot(tasks, root) ? tasks : "outside";
  } catch {
    return null;
  }
}

async function readProjectCards(
  vault: string,
  tasksDir: string,
  project: string,
  bound: Set<string>,
): Promise<Card[]> {
  const dir = join("pm", project, "tasks");
  const entries = await readdir(tasksDir, { withFileTypes: true }).catch(() => []);
  const cards: Card[] = [];
  // Regular files only: the archive/ subfolder and symlinked cards are not read.
  for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith(".md"))) {
    const cardPath = join(dir, entry.name);
    const fm = frontmatter((await readOrNull(join(tasksDir, entry.name))) ?? "");
    const blockedBy = blockers(fm.blocked_by);
    const status = text(fm.status);
    cards.push({
      cardPath,
      title: text(fm.title),
      status,
      priority: text(fm.priority),
      blockedBy,
      // obw's frontier requires `type: task` and counts a blocker only by a
      // `[[` in its value. The template writes an empty `session:` on every
      // card, so only a value counts as bound.
      dispatchable:
        fm.type === "task" &&
        status === "todo" &&
        !blockedBy.some((b) => b.includes("[[")) &&
        text(fm.session) === null &&
        !bound.has(`${vault}\0${cardPath}`),
    });
  }
  return cards.sort((a, b) => a.cardPath.localeCompare(b.cardPath));
}

/** Reads `.obsidian.yaml` files and the cards they point at. Writes nothing. */
export async function readCards(sources: CardSources): Promise<CardsReply> {
  const vaults = await vaultPaths(sources.obsidianConfigPath).catch(
    () => new Map<string, string>(),
  );
  const bound = await boundCards(sources.launchesDir);
  const repoDirs = await readdir(sources.workspaceRoot, { withFileTypes: true }).catch(() => []);
  const groups = new Map<
    string,
    { vault: string; vaultPath: string; project: string; repos: string[] }
  >();
  const skipped: CardsReply["skipped"] = [];

  for (const dir of repoDirs
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const repo = join(sources.workspaceRoot, dir.name);
    const raw = await readOrNull(join(repo, ".obsidian.yaml"));
    if (raw === null) continue;
    const config = record(parseYaml(raw));
    const vault = text(config?.vault);
    const project = text(record(config?.pm)?.project);
    if (config === null || (config.pm !== undefined && project === null)) {
      skipped.push({ repo, reason: "invalid_config" });
      continue;
    }
    if (project === null) continue;
    if (vault === null || !PROJECT_NAME.test(project)) {
      skipped.push({ repo, reason: "invalid_config" });
      continue;
    }
    const vaultPath = vaults.get(vault);
    if (vaultPath === undefined) {
      skipped.push({ repo, reason: "vault_not_found" });
      continue;
    }
    const key = `${vault}\0${project}`;
    const group = groups.get(key) ?? { vault, vaultPath, project, repos: [] };
    group.repos.push(repo);
    groups.set(key, group);
  }

  const roots = new Map<string, string | null>();
  const projects: CardProject[] = [];
  for (const { vault, vaultPath, project, repos } of groups.values()) {
    if (!roots.has(vaultPath)) {
      roots.set(
        vaultPath,
        await resolveByLstat(vaultPath).then(
          (r) => r.path,
          () => null,
        ),
      );
    }
    const tasksDir = await resolveTasksDir(vaultPath, roots.get(vaultPath) ?? null, project);
    if (tasksDir === "outside") {
      for (const repo of repos) skipped.push({ repo, reason: "tasks_outside_vault" });
      continue;
    }
    projects.push({
      vault,
      project,
      repos,
      cards: tasksDir === null ? [] : await readProjectCards(vault, tasksDir, project, bound),
    });
  }
  projects.sort((a, b) => a.project.localeCompare(b.project) || a.vault.localeCompare(b.vault));
  skipped.sort((a, b) => a.repo.localeCompare(b.repo));
  return { projects, skipped };
}

export function createCardsPlugin(opts: CardSources & { config: ServerConfig }) {
  return new Elysia().get(`${opts.config.basePath}/api/cards`, () => readCards(opts));
}
