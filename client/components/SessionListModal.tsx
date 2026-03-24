import { useEffect, useState } from "react";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";

interface SessionListModalProps {
  isOpen: boolean;
  dir?: string;
  onClose: () => void;
  onSelectSession: (sdkSessionId: string, cwd: string) => void;
}

const PAGE_SIZE = 20;

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
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [allSessions, setAllSessions] = useState<typeof sessionList>([]);

  useEffect(() => {
    if (isOpen) {
      setOffset(0);
      setAllSessions([]);
      setHasMore(true);
      wsService.listSessions(dir, PAGE_SIZE, 0);
    }
  }, [isOpen, dir]);

  useEffect(() => {
    if (offset === 0) {
      setAllSessions(sessionList);
    } else {
      setAllSessions((prev) => [...prev, ...sessionList]);
    }
    if (sessionList.length < PAGE_SIZE) {
      setHasMore(false);
    }
  }, [sessionList, offset]);

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
          {allSessions.length === 0 ? (
            <p className="session-list-empty">No sessions found for this project</p>
          ) : (
            <>
              {allSessions.map((session) => (
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
              ))}
              {hasMore && allSessions.length > 0 && (
                <button
                  type="button"
                  className="session-list-load-more"
                  onClick={() => {
                    const newOffset = offset + PAGE_SIZE;
                    setOffset(newOffset);
                    wsService.listSessions(dir, PAGE_SIZE, newOffset);
                  }}
                >
                  Load More
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
