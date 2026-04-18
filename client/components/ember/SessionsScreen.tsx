import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toastService } from "../../services/toast-service";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import RecentDrawer from "../drawers/RecentDrawer";
import FolderPicker from "../FolderPicker";
import IconButton from "./IconButton";
import ScreenHeader from "./ScreenHeader";

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

interface SessionCardProps {
  variant: "active" | "inactive" | "recent";
  title: string;
  subtitle?: string;
  badge?: { text: string; color: "sage" | "dim" };
  branch?: string;
  scope?: string;
  messageCount?: number;
  relativeTime?: string;
  onClick: () => void;
  onClose?: () => void;
}

function SessionCard({
  variant,
  title,
  subtitle,
  badge,
  branch,
  scope,
  messageCount,
  relativeTime,
  onClick,
  onClose,
}: SessionCardProps) {
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`ember-session-card ember-session-card--${variant}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="ember-session-card-header">
        {badge && (
          <span className="ember-session-badge" data-color={badge.color}>
            ● {badge.text}
          </span>
        )}
        {relativeTime && <span className="ember-session-time">{relativeTime}</span>}
      </div>
      <div className="ember-session-title">{title}</div>
      <div className="ember-session-footer">
        {branch && <span className="ember-branch-pill">⎇ {branch}</span>}
        {scope && <span className="ember-session-scope">{scope}</span>}
        {messageCount !== undefined && (
          <span className="ember-session-meta">{messageCount} messages</span>
        )}
        {subtitle && <span className="ember-session-meta">{subtitle}</span>}
      </div>
      {onClose && (
        <button
          type="button"
          className="ember-session-card-close"
          onClick={handleClose}
          aria-label="Close session"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export default function SessionsScreen() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessionList = useAppStore((s) => s.sessionList);
  const globalError = useAppStore((s) => s.globalError);
  const connectionState = useAppStore((s) => s.connectionState);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const setGlobalError = useAppStore((s) => s.setGlobalError);

  const [showRecentDrawer, setShowRecentDrawer] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Load session history on mount
  useEffect(() => {
    if (connectionState === "connected" && sessionList.length === 0) {
      setIsLoadingHistory(true);
      wsService.listSessions();
      // Assume loading completes when sessionList updates
      const timeout = setTimeout(() => setIsLoadingHistory(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [connectionState, sessionList.length]);

  // Stop loading when sessionList is populated
  useEffect(() => {
    if (sessionList.length > 0) {
      setIsLoadingHistory(false);
    }
  }, [sessionList]);

  // Compute current subtitle
  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;
  const subtitle = activeSession ? getBasename(activeSession.cwd) : "No active session";

  // Handle click on recent session
  const handleResumeSession = (sdkSessionId: string, cwd: string) => {
    try {
      wsService.resumeSession(sdkSessionId, cwd);
      setActiveScreen("chat");
    } catch (err) {
      toastService.error("Could not resume session");
    }
  };

  // Handle "+ New" flow
  const handleNewSession = () => {
    setShowRecentDrawer(true);
  };

  const handleSelectProject = (cwd: string) => {
    setShowRecentDrawer(false);
    wsService.createSession(cwd);
    // Session will be created via session_created event
    setActiveScreen("chat");
  };

  const handleBrowseNew = () => {
    setShowRecentDrawer(false);
    setShowFolderPicker(true);
  };

  const handleFolderSelect = (path: string) => {
    setShowFolderPicker(false);
    wsService.createSession(path);
    setActiveScreen("chat");
  };

  const handleCloseSession = (sessionId: string) => {
    wsService.closeSession(sessionId);
    // If closing the active session and there are other sessions, switch to the first one
    if (sessionId === activeSessionId) {
      const remainingSessions = Array.from(sessions.keys()).filter((id) => id !== sessionId);
      if (remainingSessions.length > 0) {
        setActiveSession(remainingSessions[0]);
      }
    }
  };

  // Active sessions array
  const activeSessions = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    ...session,
  }));

  return (
    <>
      <ScreenHeader
        title="Sessions"
        subtitle={subtitle}
        rightSlot={
          <IconButton
            icon={<Plus size={20} />}
            onClick={handleNewSession}
            label="New session"
            variant="accent"
          />
        }
      />

      <div className="ember-sessions-screen">
        {/* Global error banner */}
        {globalError && (
          <div className="ember-error-banner">
            <span>{globalError}</span>
            <button
              type="button"
              className="ember-error-banner-close"
              onClick={() => setGlobalError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Active Sessions */}
        <section className="ember-sessions-section">
          <h2 className="ember-sessions-heading">ACTIVE</h2>
          {activeSessions.length === 0 ? (
            <div className="ember-sessions-empty">No active sessions yet. Tap + New to start.</div>
          ) : (
            <div className="ember-sessions-list">
              {activeSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const badge = session.isStreaming
                  ? { text: "ACTIVE", color: "sage" as const }
                  : { text: "IDLE", color: "dim" as const };

                return (
                  <SessionCard
                    key={session.id}
                    variant={isActive ? "active" : "inactive"}
                    title={getBasename(session.cwd)}
                    badge={badge}
                    scope={session.cwd}
                    messageCount={session.messages.length}
                    onClick={() => {
                      setActiveSession(session.id);
                      setActiveScreen("chat");
                    }}
                    onClose={() => handleCloseSession(session.id)}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Sessions */}
        <section className="ember-sessions-section">
          <h2 className="ember-sessions-heading">RECENT</h2>
          {isLoadingHistory ? (
            <div className="ember-sessions-loading">Loading session history...</div>
          ) : connectionState !== "connected" && sessionList.length === 0 ? (
            <div className="ember-sessions-error">
              <p>Could not load session history</p>
              <button
                type="button"
                className="ember-sessions-retry"
                onClick={() => wsService.listSessions()}
              >
                Retry
              </button>
            </div>
          ) : sessionList.length === 0 ? (
            <div className="ember-sessions-empty">No recent sessions.</div>
          ) : (
            <div className="ember-sessions-list">
              {sessionList.map((session) => (
                <SessionCard
                  key={session.sdkSessionId}
                  variant="recent"
                  title={session.displayTitle || getBasename(session.cwd)}
                  branch={session.gitBranch}
                  subtitle={formatRelativeTime(session.lastModified)}
                  onClick={() => handleResumeSession(session.sdkSessionId, session.cwd)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Drawers */}
      <RecentDrawer
        open={showRecentDrawer}
        onOpenChange={setShowRecentDrawer}
        onSelectProject={handleSelectProject}
        onBrowseNew={handleBrowseNew}
      />
      <FolderPicker
        isOpen={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleFolderSelect}
      />
    </>
  );
}
