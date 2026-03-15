import { useState } from "react";
import { useAppStore } from "../stores/app-store";
import { wsService } from "../services/ws-service";

export default function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const [showNewSession, setShowNewSession] = useState(sessions.size === 0);
  const [newCwd, setNewCwd] = useState("");

  const sessionList = [...sessions.values()];

  const handleCreate = () => {
    const cwd = newCwd.trim();
    if (!cwd) return;
    wsService.createSession(cwd);
    setNewCwd("");
    setShowNewSession(false);
  };

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
              {session.cwd === "/" ? "~" : session.cwd.split("/").pop()}
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
          <button className="new-session-btn" onClick={handleCreate}>
            Create
          </button>
        </div>
      )}
    </div>
  );
}
