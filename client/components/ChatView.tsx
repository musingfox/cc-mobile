import { type ReactNode, useEffect, useRef, useState } from "react";
import type { ActiveAgent, ActiveTool, Message } from "../stores/app-store";
import ActivityPanel from "./ActivityPanel";
import ToolCard from "./ToolCard";

/** Minimal markdown: code blocks, inline code, bold, italic, lists */
function renderMarkdown(text: string): ReactNode {
  // Split by code blocks first
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(codeBlockRegex)) {
    const before = text.slice(lastIndex, match.index);
    if (before) parts.push(...renderBlocks(before, key));
    key += 200;
    parts.push(
      <pre key={`cb-${key}`} className="md-code-block">
        <code>{match[2]}</code>
      </pre>,
    );
    key++;
    lastIndex = (match.index ?? 0) + match[0].length;
  }

  const remaining = text.slice(lastIndex);
  if (remaining) parts.push(...renderBlocks(remaining, key));
  return parts;
}

/** Split text into paragraphs and list blocks */
function renderBlocks(text: string, startKey: number): ReactNode[] {
  const lines = text.split("\n");
  const result: ReactNode[] = [];
  let key = startKey;
  let currentList: ReactNode[] = [];
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const joined = currentParagraph.join("\n");
      if (joined.trim()) {
        result.push(
          <p key={`p-${key++}`} className="md-paragraph">
            {renderInlineSpans(joined, key)}
          </p>,
        );
        key += 50;
      }
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (currentList.length > 0) {
      result.push(
        <ul key={`ul-${key++}`} className="md-list">
          {currentList}
        </ul>,
      );
      currentList = [];
    }
  };

  for (const line of lines) {
    const listMatch = line.match(/^(\s*[-*])\s+(.*)/);
    if (listMatch) {
      flushParagraph();
      currentList.push(<li key={`li-${key++}`}>{renderInlineSpans(listMatch[2], key)}</li>);
      key += 20;
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      currentParagraph.push(line);
    }
  }

  flushParagraph();
  flushList();
  return result;
}

/** Render inline spans: `code`, **bold**, *italic* */
function renderInlineSpans(text: string, startKey: number): ReactNode[] {
  const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const spans: ReactNode[] = [];
  let lastIdx = 0;
  let key = startKey;

  for (const m of text.matchAll(inlineRegex)) {
    const before = text.slice(lastIdx, m.index);
    if (before) spans.push(before);

    const matched = m[0];
    if (matched.startsWith("`")) {
      spans.push(
        <code key={`ic-${key++}`} className="md-inline-code">
          {matched.slice(1, -1)}
        </code>,
      );
    } else if (matched.startsWith("**")) {
      spans.push(<strong key={`b-${key++}`}>{matched.slice(2, -2)}</strong>);
    } else if (matched.startsWith("*")) {
      spans.push(<em key={`i-${key++}`}>{matched.slice(1, -1)}</em>);
    }
    lastIdx = (m.index ?? 0) + m[0].length;
  }

  const after = text.slice(lastIdx);
  if (after) spans.push(after);
  return spans.length > 0 ? spans : [text];
}

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
            <ToolCard
              toolName={msg.toolName || "Unknown"}
              input={msg.toolInput || {}}
              content={msg.content}
              expanded={expandedTools.has(msg.id)}
              onToggle={() => toggleToolExpanded(msg.id)}
            />
          ) : (
            <div className="message-content">
              {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
            </div>
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
