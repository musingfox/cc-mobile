import { useEffect, useRef, useState } from "react";
import type { Message } from "../stores/app-store";

type ChatViewProps = {
  messages: Message[];
  isStreaming?: boolean;
};

export default function ChatView({ messages, isStreaming }: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

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

  return (
    <div className="chat-view" ref={scrollRef} onScroll={handleScroll}>
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
          <div className="message-content typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      )}
    </div>
  );
}
