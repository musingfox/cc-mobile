import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { loadProjects, type SavedProject } from "../../services/projects";
import { wsService } from "../../services/ws-service";
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
  const sessionList = useAppStore((s) => s.sessionList);
  const connectionState = useAppStore((s) => s.connectionState);

  const [saved, setSaved] = useState<SavedProject[]>(() => loadProjects());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (connectionState === "connected" && sessionList.length === 0) {
      setIsLoading(true);
      wsService.listSessions();
      const t = setTimeout(() => setIsLoading(false), 2000);
      return () => clearTimeout(t);
    }
  }, [connectionState, sessionList.length]);

  useEffect(() => {
    if (sessionList.length > 0) setIsLoading(false);
  }, [sessionList.length]);

  // Reload saved projects when sessions change (createSession persists)
  useEffect(() => {
    setSaved(loadProjects());
  }, [sessions.size, sessionList.length]);

  const rows = useMemo<ProjectRow[]>(() => {
    const map = new Map<string, ProjectRow>();

    const ensure = (cwd: string): ProjectRow => {
      const existing = map.get(cwd);
      if (existing) return existing;
      const row: ProjectRow = {
        cwd,
        label: basename(cwd),
        sessionCount: 0,
        hasLive: false,
        hasIdle: false,
      };
      map.set(cwd, row);
      return row;
    };

    for (const p of saved) {
      const row = ensure(p.cwd);
      if (p.label) row.label = p.label;
    }

    for (const s of sessions.values()) {
      const row = ensure(s.cwd);
      row.sessionCount += 1;
      if (s.isStreaming) row.hasLive = true;
      else row.hasIdle = true;
    }

    const seenSdkIds = new Set<string>();
    for (const s of sessionList) {
      if (seenSdkIds.has(s.sdkSessionId)) continue;
      seenSdkIds.add(s.sdkSessionId);
      const row = ensure(s.cwd);
      row.sessionCount += 1;
    }

    // Stable order: saved first (saved order), then any new cwds appended.
    const ordered: ProjectRow[] = [];
    const used = new Set<string>();
    for (const p of saved) {
      const r = map.get(p.cwd);
      if (r) {
        ordered.push(r);
        used.add(p.cwd);
      }
    }
    for (const [cwd, r] of map.entries()) {
      if (!used.has(cwd)) ordered.push(r);
    }
    return ordered;
  }, [saved, sessions, sessionList]);

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
        {isLoading && rows.length === 0 && (
          <div className="lin-projects-empty">Loading projects…</div>
        )}
        {!isLoading && rows.length === 0 && (
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
