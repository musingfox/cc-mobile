import { useEffect } from "react";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

interface SessionListModalProps {
  isOpen: boolean;
  dir?: string;
  onClose: () => void;
  onSelectSession: (sdkSessionId: string, cwd: string) => void;
}

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

export default function SessionListModal({
  isOpen,
  dir,
  onClose,
  onSelectSession,
}: SessionListModalProps) {
  const sessionList = useAppStore((s) => s.sessionList);

  useEffect(() => {
    if (isOpen) {
      wsService.listSessions(dir, 20, 0);
    }
  }, [isOpen, dir]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="modal-content"
        role="document"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Resume Session</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="session-list-body">
          {sessionList.length === 0 ? (
            <p className="session-list-empty">No sessions found for this project</p>
          ) : (
            sessionList.map((session) => (
              <button
                type="button"
                key={session.sdkSessionId}
                className="session-list-item"
                onClick={() => onSelectSession(session.sdkSessionId, session.cwd)}
              >
                <div className="session-list-title">{session.displayTitle}</div>
                <div className="session-list-meta">
                  {session.gitBranch && <span>{session.gitBranch}</span>}
                  <span>{formatRelativeTime(session.lastModified)}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
