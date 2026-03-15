import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";
import { wsService } from "../services/ws-service";
import { loadProjects, removeProject } from "../services/projects";
import SessionListModal from "./SessionListModal";

export default function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const [showNewSession, setShowNewSession] = useState(sessions.size === 0);
  const [newCwd, setNewCwd] = useState("");
  const [savedProjects, setSavedProjects] = useState(loadProjects);
  const [showMenu, setShowMenu] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sessions.size === 0) setShowNewSession(true);
  }, [sessions.size]);

  // Refresh saved projects and pre-fill defaultCwd when panel opens
  useEffect(() => {
    if (showNewSession) {
      setSavedProjects(loadProjects());
      setNewCwd(defaultCwd);
    }
  }, [showNewSession, defaultCwd]);

  useEffect(() => {
    if (!globalError) return;
    const timer = setTimeout(() => setGlobalError(null), 5000);
    return () => clearTimeout(timer);
  }, [globalError, setGlobalError]);

  const sessionList = [...sessions.values()];

  const handleCreate = (cwd?: string) => {
    const target = cwd || newCwd.trim();
    if (!target) return;
    setGlobalError(null);
    wsService.createSession(target);
  };

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

  const handleRemoveProject = (e: React.MouseEvent, cwd: string) => {
    e.stopPropagation();
    removeProject(cwd);
    setSavedProjects(loadProjects());
  };

  const handleNewSession = () => {
    setShowMenu(false);
    setShowNewSession(true);
  };

  const handleResumeSession = () => {
    setShowMenu(false);
    setShowResumeModal(true);
  };

  const handleSelectSession = (sdkSessionId: string, cwd: string) => {
    wsService.resumeSession(sdkSessionId, cwd);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  return (
    <div className="session-tabs-container" ref={menuRef}>
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
          onClick={() => setShowMenu(!showMenu)}
        >
          +
        </button>
      </div>
      {showMenu && (
        <div className="tab-menu">
          <button className="tab-menu-item" onClick={handleNewSession}>
            New Session
          </button>
          <button className="tab-menu-item" onClick={handleResumeSession}>
            Resume Session
          </button>
        </div>
      )}

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
        <div className="new-session-panel">
          {savedProjects.length > 0 && (
            <div className="saved-projects">
              {savedProjects.map((project) => (
                <button
                  key={project.cwd}
                  className="saved-project-btn"
                  onClick={() => handleCreate(project.cwd)}
                >
                  <span className="saved-project-label">{project.label}</span>
                  <span className="saved-project-path">{project.cwd}</span>
                  <span
                    className="saved-project-remove"
                    onClick={(e) => handleRemoveProject(e, project.cwd)}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="new-session-bar">
            <input
              className="new-session-input"
              value={newCwd}
              onChange={(e) => setNewCwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Or type a path (e.g. ~/workspace/my-project)"
              autoFocus
            />
            <button
              className="new-session-btn"
              onClick={() => handleCreate()}
              disabled={!newCwd.trim()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <SessionListModal
        isOpen={showResumeModal}
        onClose={() => setShowResumeModal(false)}
        onSelectSession={handleSelectSession}
      />
    </div>
  );
}
