import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { loadProjects, type SavedProject } from "../../services/projects";
import { useAppStore } from "../../stores/app-store";
import type { LinearScreen } from "./AppShell";
import "./projects.css";

interface Props {
  onNavigate: (screen: LinearScreen) => void;
  onOpenProject: (cwd: string) => void;
  onAddProject: () => void;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function tildeify(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

interface ProjectRow {
  cwd: string;
  label: string;
  sessionCount: number;
  hasLive: boolean;
  hasIdle: boolean;
}

export default function ProjectsScreen({ onNavigate, onOpenProject, onAddProject }: Props) {
  const sessions = useAppStore((s) => s.sessions);

  const [saved, setSaved] = useState<SavedProject[]>(() => loadProjects());

  // Re-read the saved list whenever the session map changes identity. Every
  // store mutation replaces the Map, so this also catches the
  // terminal_created → setTerminalReady → saveProject sequence, where the
  // optimistic session had already grown the map and the size never changes.
  useEffect(() => {
    setSaved(loadProjects());
  }, [sessions]);

  const rows = useMemo<ProjectRow[]>(() => {
    // Rows come from the saved projects alone — a session whose cwd was never
    // saved (or whose project the user removed) conjures no row.
    return saved.map((p) => {
      const row: ProjectRow = {
        cwd: p.cwd,
        label: p.label || basename(p.cwd),
        sessionCount: 0,
        hasLive: false,
        hasIdle: false,
      };
      for (const s of sessions.values()) {
        if (s.cwd !== p.cwd) continue;
        row.sessionCount += 1;
        if (s.agentState === "running") row.hasLive = true;
        // Gated on "the server has spoken about this session", not on a
        // truthy state: a card restored from localStorage but not yet
        // reconciled must stay dark rather than claim an activity nobody
        // confirmed. A session herdr reported as "unknown" is still spoken
        // for, and honestly shows the amber "active" dot.
        if (s.receivedAuthoritativeState) row.hasIdle = true;
      }
      return row;
    });
  }, [saved, sessions]);

  const totalCount = rows.length;

  return (
    <div className="lin-projects">
      <header className="lin-projects-header">
        <button
          type="button"
          className="lin-btn lin-sessions-icon-btn"
          onClick={() => onNavigate("settings")}
          aria-label="Settings"
        >
          <Icon name="settings" size={18} color={T.fg2} />
        </button>
        <div className="lin-projects-title">Projects</div>
        <button
          type="button"
          className="lin-btn lin-sessions-icon-btn"
          onClick={onAddProject}
          aria-label="Add project"
        >
          <Icon name="plus" size={18} color={T.fg2} />
        </button>
      </header>

      <div className="lin-projects-body lin-scroll">
        {rows.length === 0 && (
          <div className="lin-projects-empty">
            <div>No projects yet.</div>
            <button type="button" className="lin-projects-empty-cta" onClick={onAddProject}>
              + Add your first project
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <section className="lin-projects-group">
            <div className="lin-projects-group-label">Projects · {totalCount}</div>
            {rows.map((r) => (
              <ProjectRowView key={r.cwd} row={r} onOpen={() => onOpenProject(r.cwd)} />
            ))}
          </section>
        )}
      </div>

      <footer className="lin-projects-footer">
        <button type="button" className="lin-projects-cta" onClick={onAddProject}>
          <Icon name="plus" size={13} color={T.fg2} />
          <span>Add project…</span>
        </button>
      </footer>
    </div>
  );
}

function ProjectRowView({ row, onOpen }: { row: ProjectRow; onOpen: () => void }) {
  const live = row.hasLive;
  const idle = !live && row.hasIdle;
  return (
    <button type="button" className="lin-project-row" onClick={onOpen}>
      <span className="lin-project-icon">
        <Icon name="folder" size={16} color={T.fg2} />
      </span>
      <div className="lin-project-main">
        <div className="lin-project-title-row">
          <span className="lin-project-title">{row.label}</span>
          {(live || idle) && (
            <span
              className="lin-project-live-dot"
              style={
                !live
                  ? { background: "#c2b89a", boxShadow: "0 0 0 2px rgba(194,184,154,0.18)" }
                  : undefined
              }
              aria-label={live ? "live" : "active"}
            />
          )}
        </div>
        <div className="lin-project-meta">
          <span>{tildeify(row.cwd)}</span>
          {row.sessionCount > 0 && (
            <>
              <span className="lin-dot-sep">·</span>
              <span>
                {row.sessionCount} session{row.sessionCount === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
      </div>
      <Icon name="chevronR" size={14} color={T.fg3} />
    </button>
  );
}
