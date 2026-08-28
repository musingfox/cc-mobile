import { useMemo, useState } from "react";
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
  age: string;
  live: boolean;
  /** The user started this one in their own terminal, not from the phone. */
  foreign: boolean;
  /** claude runs there with no permission gate — it will not stop to ask. */
  ungated: boolean;
  /** Replies cannot be read back: herdr has no transcript key for that pane. */
  unreadable: boolean;
  /** Another agent runs there, in herdr's wording. Absent when unknown. */
  agent?: string;
  onClick: () => void;
  /**
   * Absent on a session the user opened in their own terminal: closing it would
   * take down the terminal they are sitting in, so the server refuses it and
   * the control is not offered rather than offered and then denied.
   */
  onClose?: () => void;
}

export default function ProjectDetailScreen({ cwd, onNavigate, onBack }: Props) {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const availableAgents = useAppStore((s) => s.availableAgents);
  const agentProfiles = useAppStore((s) => s.agentProfiles);

  const [menuOpen, setMenuOpen] = useState(false);

  // Only sessions herdr is actually running. Past conversations are not
  // listable any more — there is nothing to reopen read-only.
  const rows = useMemo<SessionRowItem[]>(() => {
    const items: SessionRowItem[] = [];

    for (const [id, s] of sessions.entries()) {
      if (s.cwd !== cwd) continue;
      const foreign = s.descriptor?.origin === "foreign";
      items.push({
        key: `mem-${id}`,
        // The pane names itself; how much of it this phone has read is not a
        // name. Deriving the title from `messages.length` labelled every pane
        // the phone had not spoken to "new session" — including ones that had
        // been running for hours — and made N such rows indistinguishable.
        // With no title from herdr the pane id is what is actually known, and
        // it is the same id herdr shows, so it cross-references.
        title: s.descriptor?.title ?? id,
        age: id === activeSessionId ? "current" : "open",
        live: s.agentState === "running",
        foreign,
        ungated: s.descriptor?.gated === false,
        unreadable: s.descriptor?.readable === false,
        // Only a kind herdr actually reported, and only when it is not claude:
        // an unlabelled pane stays unlabelled rather than being guessed at.
        agent: s.descriptor?.agent !== "claude" ? s.descriptor?.agent : undefined,
        onClick: () => {
          setActiveSession(id);
          onNavigate("chat");
        },
        // ponytail: the platform's own dialog rather than a sheet component
        // this codebase does not have. Closing kills the agent in that pane and
        // the conversation with it, and a mis-tap while scrolling a list is
        // exactly how that happens — so it asks. Swap for a sheet if the native
        // alert reads wrong inside the installed PWA.
        onClose: foreign
          ? undefined
          : () => {
              if (!window.confirm("Close this session? The agent running in it will be stopped.")) {
                return;
              }
              wsService.closeSession(id);
            },
      });
    }

    return items;
  }, [sessions, cwd, activeSessionId, setActiveSession, onNavigate]);

  const handleNewSession = (agentKind?: string) => {
    wsService.createTerminalSession(cwd, agentKind);
    onNavigate("chat");
  };

  // A profile is answered with its id alone. Deliberately not routed through
  // `handleNewSession`: the server refuses a create carrying both a kind and a
  // profile, and a call site with no way to name a kind cannot produce that.
  const handleNewSessionFromProfile = (profileId: string) => {
    wsService.createTerminalSessionFromProfile(cwd, profileId);
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
              <div key={r.key} className="lin-session-row-wrap">
                <button type="button" className="lin-session-row" onClick={r.onClick}>
                  <span className="lin-session-rail" />
                  <div className="lin-session-title">{r.title}</div>
                  <div className="lin-session-meta">
                    <span className="lin-session-meta-left">
                      <span>{r.age}</span>
                      {r.foreign && <span className="lin-session-badge">terminal</span>}
                      {/* Disclosure, never a lock: the session stays drivable
                          and only the badge says so (Decision H4). */}
                      {r.ungated && (
                        <span className="lin-session-badge is-warn">no permission gate</span>
                      )}
                      {r.unreadable && <span className="lin-session-badge">no readback</span>}
                      {r.agent && <span className="lin-session-badge">{r.agent}</span>}
                    </span>
                    <span className={`lin-session-live ${r.live ? "is-live" : "is-idle"}`}>
                      ● {r.live ? "Live" : "Active"}
                    </span>
                  </div>
                </button>
                {r.onClose && (
                  <button
                    type="button"
                    className="lin-session-close"
                    onClick={r.onClose}
                    aria-label={`Close session ${r.title}`}
                  >
                    <Icon name="close" size={14} color={T.fg3} />
                  </button>
                )}
              </div>
            ))
          )}
        </section>
      </div>

      {/* One button per launchable agent — but only once there is a choice to
          make. With a single kind (or before server_config arrives) this is
          byte-for-byte the button that was always here. */}
      <footer className="lin-projects-footer">
        {availableAgents.length > 1 ? (
          availableAgents.map((kind) => (
            <button
              key={kind}
              type="button"
              className="lin-projects-cta"
              onClick={() => handleNewSession(kind)}
            >
              <Icon name="plus" size={13} color={T.fg2} />
              <span>New {kind} session</span>
            </button>
          ))
        ) : (
          <button type="button" className="lin-projects-cta" onClick={() => handleNewSession()}>
            <Icon name="plus" size={13} color={T.fg2} />
            <span>New session in this project</span>
          </button>
        )}
        {/* Declared launch profiles, appended rather than substituted: the kind
            buttons above are unchanged and this list is empty when the server
            declares no profile. The label is the server's own wording and the
            id is the only thing the tap sends. */}
        {agentProfiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className="lin-projects-cta"
            onClick={() => handleNewSessionFromProfile(profile.id)}
          >
            <Icon name="plus" size={13} color={T.fg2} />
            <span>{profile.label}</span>
          </button>
        ))}
      </footer>
    </div>
  );
}
