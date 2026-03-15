import { useState, useEffect } from "react";
import { useAppStore } from "../stores/app-store";
import { wsService } from "../services/ws-service";

export default function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const [showNewSession, setShowNewSession] = useState(sessions.size === 0);
  const [newCwd, setNewCwd] = useState("");

  // Auto-show input when no sessions
  useEffect(() => {
    if (sessions.size === 0) setShowNewSession(true);
  }, [sessions.size]);

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (!globalError) return;
    const timer = setTimeout(() => setGlobalError(null), 5000);
    return () => clearTimeout(timer);
  }, [globalError, setGlobalError]);

  const sessionList = [...sessions.values()];

  const handleCreate = () => {
    const cwd = newCwd.trim();
    if (!cwd) return;
    setGlobalError(null);
    wsService.createSession(cwd);
    // Don't clear input yet — wait for success or error
  };

  // Clear input and hide on successful session creation
  useEffect(() => {
    if (sessions.size > 0 && showNewSession && newCwd.trim()) {
      setNewCwd("");
      setShowNewSession(false);
    }
  }, [sessions.size]);

  const handleClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    wsService.closeSession(sessionId);
  };

  return (
    <div className="session-tabs-container">
      <div className="session-tabs">
        {sessionList.map((session) => (
          <button
            key={session.id}
            className={`session-tab ${session.id === activeSessionId ? "active" : ""}`}
            onClick={() => setActiveSession(session.id)}
          >
            <span className="session-tab-label">
              {session.cwd.split("/").pop() || session.cwd}
            </span>
            {session.isStreaming && <span className="session-tab-streaming" />}
            {sessionList.length > 1 && (
              <span
                className="session-tab-close"
                onClick={(e) => handleClose(e, session.id)}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button
          className="session-tab add"
          onClick={() => setShowNewSession(!showNewSession)}
        >
          +
        </button>
      </div>

      {globalError && (
        <div className="global-error">
          {globalError}
          <button
            className="global-error-dismiss"
            onClick={() => setGlobalError(null)}
          >
            ×
          </button>
        </div>
      )}

      {showNewSession && (
        <div className="new-session-bar">
          <input
            className="new-session-input"
            value={newCwd}
            onChange={(e) => setNewCwd(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="Working directory (e.g. ~/workspace/my-project)"
            autoFocus
          />
          <button
            className="new-session-btn"
            onClick={handleCreate}
            disabled={!newCwd.trim()}
          >
            Create
          </button>
        </div>
      )}
    </div>
  );
}
