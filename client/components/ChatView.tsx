import { useEffect, useRef, useState } from "react";
import type { ActiveAgent, ActiveTool, Message, ResolvedAction } from "../stores/app-store";
import ActivityPanel from "./ActivityPanel";
import AnimatedMessage from "./animated/AnimatedMessage";
import MarkdownRenderer from "./MarkdownRenderer";
import ResolvedActionChip from "./ResolvedActionChip";
import ToolCard from "./ToolCard";

type ChatViewProps = {
  messages: Message[];
  resolvedActions?: ResolvedAction[];
  isStreaming?: boolean;
  activeToolStatus?: { toolName: string; description: string } | null;
  activeTools?: Map<string, ActiveTool>;
  activeAgents?: Map<string, ActiveAgent>;
  activeHook?: { hookId: string; hookName: string } | null;
  cwd?: string;
  onResumeSession?: (cwd: string) => void;
};

type TimelineItem =
  | { kind: "message"; data: Message; index: number }
  | { kind: "action"; data: ResolvedAction };

function buildTimeline(messages: Message[], actions: ResolvedAction[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m, i) => ({ kind: "message" as const, data: m, index: i })),
    ...actions.map((a) => ({ kind: "action" as const, data: a })),
  ];
  items.sort((a, b) => {
    const ta = a.kind === "message" ? a.data.timestamp : a.data.timestamp;
    const tb = b.kind === "message" ? b.data.timestamp : b.data.timestamp;
    return ta - tb;
  });
  return items;
}

export default function ChatView({
  messages,
  resolvedActions = [],
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

  // Scroll to bottom when messages change
  const prevCountRef = useRef(messages.length);
  const prevContentRef = useRef(messages[messages.length - 1]?.content);
  if (
    messages.length !== prevCountRef.current ||
    messages[messages.length - 1]?.content !== prevContentRef.current
  ) {
    prevCountRef.current = messages.length;
    prevContentRef.current = messages[messages.length - 1]?.content;
    if (autoScroll && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }

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
      {buildTimeline(messages, resolvedActions).map((item, timelineIdx) => {
        const isLastAssistant =
          isStreaming &&
          item.kind === "message" &&
          item.data.role === "assistant" &&
          item.index === messages.length - 1;

        return item.kind === "action" ? (
          <AnimatedMessage key={item.data.id} index={0} className="resolved-action-row">
            <ResolvedActionChip action={item.data} />
          </AnimatedMessage>
        ) : (
          <AnimatedMessage
            key={item.data.id}
            index={item.index}
            className={`message ${item.data.role}`}
            isStreaming={isLastAssistant}
          >
            <div>
              {item.data.role === "tool" ? (
                <ToolCard
                  toolName={item.data.toolName || "Unknown"}
                  input={item.data.toolInput || {}}
                  content={item.data.content}
                  expanded={expandedTools.has(item.data.id)}
                  onToggle={() => toggleToolExpanded(item.data.id)}
                />
              ) : (
                <div className="message-content">
                  {item.data.role === "assistant" ? (
                    <MarkdownRenderer content={item.data.content} />
                  ) : (
                    item.data.content
                  )}
                </div>
              )}
              <div className="message-timestamp">{formatTimestamp(item.data.timestamp)}</div>
            </div>
          </AnimatedMessage>
        );
      })}
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
