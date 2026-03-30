import { motion } from "framer-motion";
import { FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadProjects, removeProject } from "../services/projects";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";
import { springSnappy } from "../utils/motion-variants";
import FolderPicker from "./FolderPicker";

export default function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const [showProjectPicker, setShowProjectPicker] = useState(
    sessions.size === 0 && !activeSessionId,
  );
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [savedProjects, setSavedProjects] = useState(loadProjects);

  useEffect(() => {
    if (sessions.size === 0 && !activeSessionId) setShowProjectPicker(true);
    if (activeSessionId) setShowProjectPicker(false);
  }, [sessions.size, activeSessionId]);

  useEffect(() => {
    if (showProjectPicker) {
      setSavedProjects(loadProjects());
      setNewCwd(defaultCwd);
    }
  }, [showProjectPicker, defaultCwd]);

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
    if (sessions.size > 0 && showProjectPicker && newCwd.trim()) {
      setNewCwd("");
      setShowProjectPicker(false);
    }
  }, [sessions.size, newCwd.trim, showProjectPicker]);

  const handleClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    wsService.closeSession(sessionId);
  };

  const handleRemoveProject = (e: React.MouseEvent, cwd: string) => {
    e.stopPropagation();
    removeProject(cwd);
    setSavedProjects(loadProjects());
  };

  const handleFolderSelect = (path: string) => {
    handleCreate(path);
    setShowFolderPicker(false);
  };

  return (
    <div className="session-tabs-container">
      <div className="session-tabs">
        {sessionList.map((session) => (
          <div
            key={session.id}
            className={`session-tab ${session.id === activeSessionId ? "active" : ""}`}
          >
            <button
              type="button"
              className="session-tab-main"
              onClick={() => setActiveSession(session.id)}
            >
              <span className="session-tab-label">
                {session.cwd.split("/").pop() || session.cwd}
              </span>
              {session.isStreaming && <span className="session-tab-streaming" />}
            </button>
            {session.id === activeSessionId && (
              <motion.div
                className="session-tab-indicator"
                layoutId="activeTabIndicator"
                transition={springSnappy}
              />
            )}
            {sessionList.length > 1 && (
              <button
                type="button"
                className="session-tab-close"
                onClick={(e) => handleClose(e, session.id)}
              >
                <X size={20} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="session-tab add"
          onClick={() => setShowProjectPicker(!showProjectPicker)}
        >
          +
        </button>
      </div>

      {globalError && (
        <div className="global-error">
          {globalError}
          <button
            type="button"
            className="global-error-dismiss"
            onClick={() => setGlobalError(null)}
          >
            <X size={20} />
          </button>
        </div>
      )}

      {showProjectPicker && (
        <div className="new-session-panel">
          {savedProjects.length > 0 && (
            <div className="saved-projects">
              {savedProjects.map((project) => (
                <div key={project.cwd} className="saved-project-btn">
                  <button
                    type="button"
                    className="saved-project-main"
                    onClick={() => handleCreate(project.cwd)}
                  >
                    <span className="saved-project-label">{project.label}</span>
                    <span className="saved-project-path">{project.cwd}</span>
                  </button>
                  <button
                    type="button"
                    className="saved-project-remove"
                    onClick={(e) => handleRemoveProject(e, project.cwd)}
                  >
                    <X size={20} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="new-session-bar">
            <button
              type="button"
              className="folder-browse-btn"
              onClick={() => setShowFolderPicker(true)}
              title="Browse folders"
            >
              <FolderOpen size={20} />
            </button>
            <input
              className="new-session-input"
              value={newCwd}
              onChange={(e) => setNewCwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Or type a path (e.g. ~/workspace/my-project)"
            />
            <button
              type="button"
              className="new-session-btn"
              onClick={() => handleCreate()}
              disabled={!newCwd.trim()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      <FolderPicker
        open={showFolderPicker}
        onSelect={handleFolderSelect}
        onClose={() => setShowFolderPicker(false)}
      />
    </div>
  );
}
