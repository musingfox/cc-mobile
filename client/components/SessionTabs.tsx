import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { saveProject } from "../services/projects";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import { springSnappy } from "../utils/motion-variants";
import RecentDrawer from "./drawers/RecentDrawer";
import FolderPicker from "./FolderPicker";

export default function SessionTabs() {
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const [showRecentDrawer, setShowRecentDrawer] = useState(sessions.size === 0 && !activeSessionId);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  useEffect(() => {
    if (sessions.size === 0 && !activeSessionId) setShowRecentDrawer(true);
    if (activeSessionId) setShowRecentDrawer(false);
  }, [sessions.size, activeSessionId]);

  useEffect(() => {
    if (!globalError) return;
    const timer = setTimeout(() => setGlobalError(null), 5000);
    return () => clearTimeout(timer);
  }, [globalError, setGlobalError]);

  const sessionList = [...sessions.values()];

  const handleClose = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    wsService.closeSession(sessionId);
  };

  const handleSelectProject = (cwd: string) => {
    setGlobalError(null);
    saveProject(cwd);
    wsService.createSession(cwd);
    setShowRecentDrawer(false);
  };

  const handleBrowseNew = () => {
    setShowFolderPicker(true);
  };

  const handleFolderSelect = (path: string) => {
    setGlobalError(null);
    saveProject(path);
    wsService.createSession(path);
    setShowFolderPicker(false);
    setShowRecentDrawer(false);
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
        <button type="button" className="session-tab add" onClick={() => setShowRecentDrawer(true)}>
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

      <RecentDrawer
        open={showRecentDrawer}
        onOpenChange={setShowRecentDrawer}
        onSelectProject={handleSelectProject}
        onBrowseNew={handleBrowseNew}
      />

      <FolderPicker
        open={showFolderPicker}
        onSelect={handleFolderSelect}
        onClose={() => setShowFolderPicker(false)}
        nested={true}
      />
    </div>
  );
}
