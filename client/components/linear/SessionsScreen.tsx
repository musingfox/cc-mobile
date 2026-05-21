import { useEffect, useMemo, useState } from "react";
import type { SessionListItem } from "../../../server/protocol";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { toastService } from "../../services/toast-service";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import FolderPicker from "../FolderPicker";
import type { LinearScreen } from "./AppShell";
import "./sessions.css";

interface Props {
  onNavigate: (screen: LinearScreen) => void;
}

type Filter = "all" | "active" | "recent";

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

interface RowItem {
  key: string;
  title: string;
  cwd: string;
  branch?: string;
  age: string;
  active: boolean;
  /** "live": currently streaming in-memory; "idle": active session but not streaming; "recent": historical */
  liveness: "live" | "idle" | "recent";
  onClick: () => void;
}

export default function SessionsScreen({ onNavigate }: Props) {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionList = useAppStore((s) => s.sessionList);
  const connectionState = useAppStore((s) => s.connectionState);
  const setActiveSession = useAppStore((s) => s.setActiveSession);

  const [filter, setFilter] = useState<Filter>("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch resumable sessions once connected.
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

  // Collect rows from in-memory sessions + historical list, dedupe by sdkSessionId.
  const rows = useMemo<RowItem[]>(() => {
    const items: RowItem[] = [];
    const seenSdkIds = new Set<string>();

    // In-memory sessions first (live / idle)
    for (const [id, s] of sessions.entries()) {
      const isActive = id === activeSessionId;
      const liveness = s.isStreaming ? "live" : "idle";
      if (s.sdkSessionId) seenSdkIds.add(s.sdkSessionId);
      items.push({
        key: `mem-${id}`,
        title: basename(s.cwd),
        cwd: s.cwd,
        branch: undefined,
        age: s.messages.length > 0 ? `${s.messages.length} msgs` : "new",
        active: isActive,
        liveness,
        onClick: () => {
          setActiveSession(id);
          onNavigate("chat");
        },
      });
    }

    // Historical sessions
    for (const s of sessionList) {
      if (seenSdkIds.has(s.sdkSessionId)) continue;
      items.push({
        key: `srv-${s.sdkSessionId}`,
        title: s.displayTitle || basename(s.cwd),
        cwd: s.cwd,
        branch: s.gitBranch,
        age: relativeTime(s.lastModified),
        active: false,
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
  }, [sessions, activeSessionId, sessionList, setActiveSession, onNavigate]);

  const filtered = useMemo(() => {
    if (filter === "active")
      return rows.filter((r) => r.liveness === "live" || r.liveness === "idle");
    if (filter === "recent") return rows.filter((r) => r.liveness === "recent");
    return rows;
  }, [rows, filter]);

  // Group by cwd.
  const grouped = useMemo(() => {
    const map = new Map<string, RowItem[]>();
    for (const r of filtered) {
      const k = r.cwd;
      const arr = map.get(k) ?? [];
      arr.push(r);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totalCount = rows.length;

  const handleFolderSelect = (path: string) => {
    setPickerOpen(false);
    wsService.createSession(path);
    onNavigate("chat");
  };

  return (
    <div className="lin-sessions">
      <header className="lin-sessions-header">
        <button
          type="button"
          className="lin-btn lin-sessions-icon-btn"
          onClick={() => onNavigate("settings")}
          aria-label="Settings"
        >
          <Icon name="settings" size={18} color={T.fg2} />
        </button>
        <div className="lin-sessions-title">Sessions</div>
        <div className="lin-sessions-count">{totalCount}</div>
      </header>

      <div className="lin-sessions-filters">
        {(["all", "active", "recent"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`lin-pill ${filter === f ? "is-active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "active" ? "Active" : "Recent"}
          </button>
        ))}
      </div>

      <div className="lin-sessions-body lin-scroll">
        {isLoading && rows.length === 0 && (
          <div className="lin-sessions-empty">Loading sessions…</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="lin-sessions-empty">No sessions yet. Tap "New session" below.</div>
        )}
        {grouped.map(([cwd, items]) => (
          <section key={cwd} className="lin-sessions-group">
            <div className="lin-sessions-group-label">{basename(cwd)}</div>
            {items.map((r) => (
              <SessionRow key={r.key} row={r} />
            ))}
          </section>
        ))}
      </div>

      <footer className="lin-sessions-footer">
        <button type="button" className="lin-sessions-new" onClick={() => setPickerOpen(true)}>
          <Icon name="plus" size={13} color={T.fg2} />
          <span>New session…</span>
        </button>
      </footer>

      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleFolderSelect}
      />
    </div>
  );
}

function SessionRow({ row }: { row: RowItem }) {
  return (
    <button type="button" className="lin-session-row" onClick={row.onClick}>
      {row.active && <span className="lin-session-rail" />}
      <div className="lin-session-title">{row.title}</div>
      <div className="lin-session-meta">
        <span className="lin-session-meta-left">
          {row.branch ? (
            <>
              <Icon name="branch" size={10} color={T.fg3} />
              <span>{row.branch}</span>
              <span className="lin-dot-sep">·</span>
            </>
          ) : null}
          <span>{row.age}</span>
        </span>
        {row.liveness !== "recent" && (
          <span className={`lin-session-live ${row.liveness === "live" ? "is-live" : "is-idle"}`}>
            ● {row.liveness === "live" ? "Live" : "Active"}
          </span>
        )}
      </div>
    </button>
  );
}
