import { useEffect, useRef, useState } from "react";
import type { Message } from "../stores/app-store";
import { loadProjects } from "../services/projects";

type ChatViewProps = {
  messages: Message[];
  isStreaming?: boolean;
  activeToolStatus?: { toolName: string; description: string } | null;
  onNewSession?: (cwd: string) => void;
  onResumeSession?: (cwd: string) => void;
};

export default function ChatView({ messages, isStreaming, activeToolStatus, onNewSession, onResumeSession }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState("");

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const toggleToolExpanded = (messageId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const showEmpty = messages.length === 0 && !isStreaming && onNewSession && onResumeSession;
  const savedProjects = showEmpty ? loadProjects() : [];

  return (
    <div className="chat-view" ref={scrollRef} onScroll={handleScroll}>
      {showEmpty && (
        <div className="chat-empty">
          {!selectedCwd ? (
            <div className="chat-empty-actions">
              <div className="chat-empty-title">Select a project</div>
              {savedProjects.map((p) => (
                <button
                  key={p.cwd}
                  className="chat-empty-btn"
                  onClick={() => setSelectedCwd(p.cwd)}
                >
                  <div className="chat-empty-btn-label">{p.label}</div>
                  <div className="chat-empty-btn-path">{p.cwd}</div>
                </button>
              ))}
              <div className="chat-empty-custom">
                <input
                  className="chat-empty-input"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customPath.trim()) {
                      setSelectedCwd(customPath.trim());
                    }
                  }}
                  placeholder="Or type a path..."
                />
              </div>
            </div>
          ) : (
            <div className="chat-empty-actions">
              <div className="chat-empty-title">
                {selectedCwd.split("/").pop() || selectedCwd}
              </div>
              <div className="chat-empty-subtitle">{selectedCwd}</div>
              <button
                className="chat-empty-btn"
                onClick={() => onNewSession(selectedCwd)}
              >
                + New Session
              </button>
              <button
                className="chat-empty-btn resume"
                onClick={() => onResumeSession(selectedCwd)}
              >
                Resume Session
              </button>
              <button
                className="chat-empty-back"
                onClick={() => setSelectedCwd(null)}
              >
                Back
              </button>
            </div>
          )}
        </div>
      )}
      {messages.map((msg) => (
        <div key={msg.id} className={`message ${msg.role}`}>
          {msg.role === "tool" ? (
            <div
              className={`message-content ${
                expandedTools.has(msg.id) ? "tool-expanded" : ""
              }`}
              onClick={() => toggleToolExpanded(msg.id)}
            >
              <div className="tool-header">
                <span className="tool-expand-icon">▶</span>
                <span>Tool: {msg.toolName || "Unknown"}</span>
              </div>
              {expandedTools.has(msg.id) && (
                <div className="tool-details">{msg.content}</div>
              )}
            </div>
          ) : (
            <div className="message-content">{msg.content}</div>
          )}
          <div className="message-timestamp">{formatTimestamp(msg.timestamp)}</div>
        </div>
      ))}
      {isStreaming && (
        <div className="message assistant">
          <div className="message-content status-indicator">
            <span className="status-verb">
              {activeToolStatus ? activeToolStatus.toolName : "Thinking"}
            </span>
            {activeToolStatus && activeToolStatus.description !== activeToolStatus.toolName && (
              <span className="status-detail">{activeToolStatus.description}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
