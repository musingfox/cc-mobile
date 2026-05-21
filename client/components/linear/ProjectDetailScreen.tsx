import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { removeProject } from "../../services/projects";
import { toastService } from "../../services/toast-service";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import type { LinearScreen } from "./AppShell";
import "./projects.css";
import "./sessions.css";

interface Props {
  cwd: string;
  onNavigate: (screen: LinearScreen) => void;
  onBack: () => void;
}

function relativeTime(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return "just now";
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function tildeify(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}

interface SessionRowItem {
  key: string;
  title: string;
  branch?: string;
  age: string;
  liveness: "live" | "idle" | "recent";
  onClick: () => void;
}

export default function ProjectDetailScreen({ cwd, onNavigate, onBack }: Props) {
  const sessions = useAppStore((s) => s.sessions);
  const sessionList = useAppStore((s) => s.sessionList);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const connectionState = useAppStore((s) => s.connectionState);

  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (connectionState === "connected" && sessionList.length === 0) {
      wsService.listSessions();
    }
  }, [connectionState, sessionList.length]);

  const rows = useMemo<SessionRowItem[]>(() => {
    const items: SessionRowItem[] = [];
    const seenSdkIds = new Set<string>();

    for (const [id, s] of sessions.entries()) {
      if (s.cwd !== cwd) continue;
      if (s.sdkSessionId) seenSdkIds.add(s.sdkSessionId);
      items.push({
        key: `mem-${id}`,
        title: s.messages.length > 0 ? `${s.messages.length} msgs` : "new session",
        age: id === activeSessionId ? "current" : "open",
        liveness: s.isStreaming ? "live" : "idle",
        onClick: () => {
          setActiveSession(id);
          onNavigate("chat");
        },
      });
    }

    for (const s of sessionList) {
      if (s.cwd !== cwd) continue;
      if (seenSdkIds.has(s.sdkSessionId)) continue;
      items.push({
        key: `srv-${s.sdkSessionId}`,
        title: s.displayTitle || basename(s.cwd),
        branch: s.gitBranch,
        age: relativeTime(s.lastModified),
        liveness: "recent",
        onClick: () => {
          try {
            wsService.resumeSession(s.sdkSessionId, s.cwd);
            onNavigate("chat");
          } catch {
            toastService.error("Could not resume session");
          }
        },
      });
    }

    return items;
  }, [sessions, sessionList, cwd, activeSessionId, setActiveSession, onNavigate]);

  const handleNewSession = () => {
    wsService.createSession(cwd);
    onNavigate("chat");
  };

  const handleRemove = () => {
    removeProject(cwd);
    toastService.success("Project removed");
    setMenuOpen(false);
    onBack();
  };

  return (
    <div className="lin-projects">
      <header className="lin-projects-header">
        <button
          type="button"
          className="lin-btn lin-sessions-icon-btn"
          onClick={onBack}
          aria-label="Back"
        >
          <Icon name="chevronL" size={18} color={T.fg2} />
        </button>
        <div className="lin-projects-detail-title">
          <span className="lin-projects-detail-name">{basename(cwd)}</span>
          <span className="lin-projects-path">{tildeify(cwd)}</span>
        </div>
        <button
          type="button"
          className="lin-btn lin-sessions-icon-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More"
        >
          <Icon name="dots" size={18} color={T.fg2} />
        </button>
      </header>

      {menuOpen && (
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            background: "#17171a",
          }}
        >
          <button
            type="button"
            onClick={handleRemove}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 7,
              color: T.diffRemoveText,
              padding: "8px 12px",
              fontSize: 12.5,
              cursor: "pointer",
              fontFamily:
                '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
            }}
          >
            Remove from list
          </button>
        </div>
      )}

      <div className="lin-projects-body lin-scroll">
        <section className="lin-sessions-group">
          <div className="lin-sessions-group-label">Sessions · {rows.length}</div>
          {rows.length === 0 ? (
            <div className="lin-projects-section-empty">No sessions for this project yet.</div>
          ) : (
            rows.map((r) => (
              <button key={r.key} type="button" className="lin-session-row" onClick={r.onClick}>
                {r.liveness !== "recent" && <span className="lin-session-rail" />}
                <div className="lin-session-title">{r.title}</div>
                <div className="lin-session-meta">
                  <span className="lin-session-meta-left">
                    {r.branch ? (
                      <>
                        <Icon name="branch" size={10} color={T.fg3} />
                        <span>{r.branch}</span>
                        <span className="lin-dot-sep">·</span>
                      </>
                    ) : null}
                    <span>{r.age}</span>
                  </span>
                  {r.liveness !== "recent" && (
                    <span
                      className={`lin-session-live ${
                        r.liveness === "live" ? "is-live" : "is-idle"
                      }`}
                    >
                      ● {r.liveness === "live" ? "Live" : "Active"}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </section>
      </div>

      <footer className="lin-projects-footer">
        <button type="button" className="lin-projects-cta" onClick={handleNewSession}>
          <Icon name="plus" size={13} color={T.fg2} />
          <span>New session in this project</span>
        </button>
      </footer>
    </div>
  );
}
