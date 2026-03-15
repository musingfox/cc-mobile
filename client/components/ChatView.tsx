import { useEffect, useRef, useState } from "react";
import type { ActiveAgent, ActiveTool, Message } from "../stores/app-store";
import ActivityPanel from "./ActivityPanel";

type ChatViewProps = {
  messages: Message[];
  isStreaming?: boolean;
  activeToolStatus?: { toolName: string; description: string } | null;
  activeTools?: Map<string, ActiveTool>;
  activeAgents?: Map<string, ActiveAgent>;
  activeHook?: { hookId: string; hookName: string } | null;
  cwd?: string;
  onResumeSession?: (cwd: string) => void;
};

export default function ChatView({
  messages,
  isStreaming,
  activeToolStatus,
  activeTools = new Map(),
  activeAgents = new Map(),
  activeHook,
  cwd,
  onResumeSession,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

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

  return (
    <div className="chat-view" ref={scrollRef} onScroll={handleScroll}>
      {messages.length === 0 && !isStreaming && (
        <div className="chat-empty">
          <div className="chat-empty-welcome">Type a message to start, or</div>
          {cwd && onResumeSession && (
            <button
              type="button"
              className="chat-empty-resume"
              onClick={() => onResumeSession(cwd)}
            >
              Resume a previous session
            </button>
          )}
        </div>
      )}
      {messages.map((msg) => (
        <div key={msg.id} className={`message ${msg.role}`}>
          {msg.role === "tool" ? (
            <button
              type="button"
              className={`message-content ${expandedTools.has(msg.id) ? "tool-expanded" : ""}`}
              onClick={() => toggleToolExpanded(msg.id)}
            >
              <div className="tool-header">
                <span className="tool-expand-icon">▶</span>
                <span>Tool: {msg.toolName || "Unknown"}</span>
              </div>
              {expandedTools.has(msg.id) && <div className="tool-details">{msg.content}</div>}
            </button>
          ) : (
            <div className="message-content">{msg.content}</div>
          )}
          <div className="message-timestamp">{formatTimestamp(msg.timestamp)}</div>
        </div>
      ))}
      {isStreaming && (
        <>
          {/* New rich activity panel */}
          {(activeTools.size > 0 || activeAgents.size > 0 || activeHook) && (
            <ActivityPanel
              activeTools={activeTools}
              activeAgents={activeAgents}
              activeHook={activeHook}
            />
          )}
          {/* Fallback to legacy simple indicator if no rich status */}
          {activeTools.size === 0 && activeAgents.size === 0 && !activeHook && (
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
        </>
      )}
    </div>
  );
}
