import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCardsPlugin } from "../cards";
import { testServerConfig } from "./ws-harness";

let tmp: string;
let workspace: string;
let vault: string;
let obsidianConfig: string;
let launchesDir: string;

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function repo(name: string, yaml: string) {
  write(join(workspace, name, ".obsidian.yaml"), yaml);
}

function card(project: string, file: string, frontmatter: string) {
  write(join(vault, "pm", project, "tasks", file), `---\n${frontmatter}\n---\n\n# body\n`);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "cards-api-"));
  workspace = join(tmp, "workspace");
  vault = join(tmp, "vaults", "obsidian");
  obsidianConfig = join(tmp, "obsidian.json");
  launchesDir = join(tmp, "launches");
  mkdirSync(workspace, { recursive: true });
  write(obsidianConfig, JSON.stringify({ vaults: { abc: { path: vault, ts: 1, open: true } } }));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function get() {
  const app = createCardsPlugin({
    config: testServerConfig,
    workspaceRoot: workspace,
    obsidianConfigPath: obsidianConfig,
    launchesDir,
  });
  const res = await app.handle(new Request("http://localhost/api/cards"));
  return { status: res.status, body: (await res.json()) as CardsBody };
}

interface CardsBody {
  projects: {
    vault: string;
    project: string;
    repos: string[];
    cards: {
      cardPath: string;
      title: string | null;
      status: string | null;
      priority: string | null;
      blockedBy: string[];
      dispatchable: boolean;
    }[];
  }[];
  skipped: { repo: string; reason: string }[];
}

describe("GET /api/cards", () => {
  test("groups cards by project with their fields and every candidate repo", async () => {
    repo("cyris", "vault: obsidian\npm:\n  project: cyris\n");
    repo("cyris-archive", "vault: obsidian\npm:\n  project: cyris\n");
    repo("no-pm", "vault: obsidian\n");
    card(
      "cyris",
      "a.md",
      'title: Alpha\ntype: task\nstatus: todo\npriority: high\nblocked_by: ["[[b]]"]\nsession:',
    );
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.projects).toEqual([
      {
        vault: "obsidian",
        project: "cyris",
        repos: [join(workspace, "cyris"), join(workspace, "cyris-archive")],
        cards: [
          {
            cardPath: "pm/cyris/tasks/a.md",
            title: "Alpha",
            status: "todo",
            priority: "high",
            blockedBy: ["[[b]]"],
            dispatchable: false,
          },
        ],
      },
    ]);
    expect(body.skipped).toEqual([]);
  });

  test("dispatchable means a todo task with no blocker and no binding", async () => {
    repo("p", "vault: obsidian\npm:\n  project: p\n");
    card("p", "empty-list.md", "type: task\nstatus: todo\nblocked_by: []\nsession:");
    card("p", "absent.md", "type: task\nstatus: todo");
    card("p", "null-blocker.md", "type: task\nstatus: todo\nblocked_by:");
    card("p", "blocked.md", 'type: task\nstatus: todo\nblocked_by:\n  - "[[x]]"');
    card("p", "in-progress.md", "type: task\nstatus: in-progress\nblocked_by: []");
    card(
      "p",
      "session.md",
      "type: task\nstatus: todo\nsession: 993a7502-403c-4f00-8e23-2a1622b1ea5f",
    );
    card("p", "bound-file.md", "type: task\nstatus: todo");
    card("p", "no-type.md", "status: todo");
    card("p", "doc.md", "type: doc\nstatus: todo");
    write(
      join(vault, "pm", "p", "tasks", "archive", "old.md"),
      "---\ntype: task\nstatus: todo\n---\n",
    );
    write(join(vault, "pm", "p", "tasks", "broken.md"), "---\ntitle: [unclosed\n---\n");
    write(
      join(launchesDir, "u1.json"),
      JSON.stringify({ cardPath: "pm/p/tasks/bound-file.md", vault: "obsidian", project: "p" }),
    );
    write(
      join(launchesDir, "u2.json"),
      JSON.stringify({ cardPath: "pm/p/tasks/absent.md", vault: "other-vault", project: "p" }),
    );
    write(join(launchesDir, "junk.json"), "{not json");

    const { body } = await get();
    const verdicts = Object.fromEntries(
      body.projects[0].cards.map((c) => [c.cardPath.split("/").pop(), c.dispatchable]),
    );
    expect(verdicts).toEqual({
      "absent.md": true,
      "blocked.md": false,
      "bound-file.md": false,
      "broken.md": false,
      "doc.md": false,
      "empty-list.md": true,
      "in-progress.md": false,
      "no-type.md": false,
      "null-blocker.md": true,
      "session.md": false,
    });
  });

  test("vault paths come from Obsidian's own config, not the vault name", async () => {
    const elsewhere = join(tmp, "somewhere", "work-notes");
    write(
      obsidianConfig,
      JSON.stringify({ vaults: { a: { path: vault }, b: { path: elsewhere } } }),
    );
    repo("w", "vault: work-notes\npm:\n  project: w\n");
    write(join(elsewhere, "pm", "w", "tasks", "t.md"), "---\ntitle: From elsewhere\n---\n");
    const { body } = await get();
    expect(body.projects.map((p) => [p.vault, p.cards[0]?.title])).toEqual([
      ["work-notes", "From elsewhere"],
    ]);
  });

  test("a repo whose config cannot be followed is reported, not dropped silently", async () => {
    repo("unknown-vault", "vault: nope\npm:\n  project: x\n");
    repo("traversal", "vault: obsidian\npm:\n  project: ../..\n");
    repo("hidden", "vault: obsidian\npm:\n  project: .git\n");
    repo("bad-yaml", "vault: [\n");
    const { body } = await get();
    expect(body.projects).toEqual([]);
    expect(body.skipped).toEqual([
      { repo: join(workspace, "bad-yaml"), reason: "invalid_config" },
      { repo: join(workspace, "hidden"), reason: "invalid_config" },
      { repo: join(workspace, "traversal"), reason: "invalid_config" },
      { repo: join(workspace, "unknown-vault"), reason: "vault_not_found" },
    ]);
  });

  test("a missing Obsidian config skips every repo as vault_not_found", async () => {
    rmSync(obsidianConfig);
    repo("p", "vault: obsidian\npm:\n  project: p\n");
    const { body } = await get();
    expect(body.skipped).toEqual([{ repo: join(workspace, "p"), reason: "vault_not_found" }]);
  });

  test("reading writes nothing anywhere under the workspace, the vault or the launches dir", async () => {
    repo("p", "vault: obsidian\npm:\n  project: p\n");
    card("p", "a.md", "type: task\nstatus: todo\nblocked_by: []");
    card("p", "b.md", "type: task\nstatus: todo");
    // No launches dir: the reader must not create one.
    const before = snapshot(tmp);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.projects[0].cards.map((c) => c.dispatchable)).toEqual([true, true]);
    expect(snapshot(tmp)).toEqual(before);
  });
});

/** Every path under `root` with its type, size, mtime and content hash. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = lstatSync(path);
      const hash = st.isFile() ? createHash("sha256").update(readFileSync(path)).digest("hex") : "";
      out[path.slice(root.length)] =
        `${st.isDirectory() ? "d" : "f"} ${st.size} ${st.mtimeMs} ${hash}`;
      if (st.isDirectory()) walk(path);
    }
  };
  walk(root);
  return out;
}
