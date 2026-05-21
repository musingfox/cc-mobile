import { useEffect, useRef } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import MarkdownRenderer from "../MarkdownRenderer";
import type { LinearScreen } from "./AppShell";
import InputBarA from "./InputBarA";
import PermissionSheetA from "./PermissionSheetA";
import ToolCardA from "./ToolCardA";
import "./chat.css";

interface Props {
  onNavigate: (screen: LinearScreen) => void;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export default function ChatScreen({ onNavigate }: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const session = useAppStore((s) =>
    activeSessionId ? s.sessions.get(activeSessionId) : undefined,
  );
  const capabilities = useAppStore((s) => s.capabilities);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new message / content change
  const messages = session?.messages ?? [];
  const lastContent = messages[messages.length - 1]?.content ?? "";
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, lastContent]);

  if (!activeSessionId || !session) {
    return (
      <div className="lin-chat">
        <header className="lin-chat-bar">
          <button
            type="button"
            className="lin-icon-btn"
            onClick={() => onNavigate("sessions")}
            aria-label="Back to sessions"
          >
            <Icon name="menu" size={18} color={T.fg2} />
          </button>
          <div className="lin-chat-project">
            <span className="lin-chat-title">No session</span>
          </div>
        </header>
        <div className="lin-chat-empty">
          <p>No active session.</p>
          <button
            type="button"
            className="lin-chat-empty-btn"
            onClick={() => onNavigate("sessions")}
          >
            Choose a session
          </button>
        </div>
      </div>
    );
  }

  const pendingPermission = session.pendingPermission;
  const isStreaming = session.isStreaming;
  const currentStreamMessageId = session.currentStreamMessageId;
  const activeTools = session.activeTools;
  const usage = session.usage;
  const model = capabilities?.model ?? "claude";
  const projectName = basename(session.cwd);
  // tilde-friendly path for display
  const displayPath = session.cwd.replace(/^\/Users\/[^/]+/, "~");

  const handleApprove = () => {
    if (activeSessionId) wsService.approvePermission(activeSessionId);
  };
  const handleDeny = () => {
    if (activeSessionId) wsService.denyPermission(activeSessionId);
  };

  return (
    <div className="lin-chat">
      <header className="lin-chat-bar">
        <button
          type="button"
          className="lin-icon-btn"
          onClick={() => onNavigate("sessions")}
          aria-label="Back to sessions"
        >
          <Icon name="menu" size={18} color={T.fg2} />
        </button>
        <div className="lin-chat-project">
          <span className="lin-chat-status-dot" />
          <span className="lin-chat-title">{projectName}</span>
          <span className="lin-chat-path">{displayPath}</span>
        </div>
        <span className="lin-chat-model">{model}</span>
      </header>

      <div className="lin-chat-scroll lin-scroll" ref={scrollRef}>
        {messages.length === 0 && !isStreaming && (
          <div className="lin-chat-empty-inline">Type a message to start.</div>
        )}

        {messages.map((m) => {
          if (m.role === "user") {
            return (
              <div key={m.id} className="lin-msg lin-msg--user">
                <div className="lin-msg-label">YOU</div>
                <div className="lin-msg-body">{m.content}</div>
              </div>
            );
          }
          if (m.role === "tool") {
            return (
              <ToolCardA
                key={m.id}
                toolName={m.toolName || "Unknown"}
                input={m.toolInput || {}}
                result={m.content}
              />
            );
          }
          // assistant
          const showCaret = isStreaming && m.id === currentStreamMessageId && m.content.length > 0;
          return (
            <div key={m.id} className="lin-msg lin-msg--claude">
              <div className="lin-msg-label">CLAUDE</div>
              <div className="lin-msg-body lin-md">
                <MarkdownRenderer content={m.content} isStreaming={showCaret} />
                {showCaret && <span className="lin-caret" />}
              </div>
            </div>
          );
        })}

        {/* Thinking card when streaming but no content yet */}
        {isStreaming &&
          (!currentStreamMessageId ||
            !messages.find((m) => m.id === currentStreamMessageId)?.content) && <ThinkingCard />}

        {/* Live tool activity rows */}
        {Array.from(activeTools.values()).map((t) => (
          <div key={`${t.toolName}-${t.startedAt}`} className="lin-live-row">
            <span className="lin-mini-ring" />
            <span className="lin-live-name">{t.toolName}</span>
            {t.elapsedSeconds !== undefined && (
              <span className="lin-live-elapsed">{t.elapsedSeconds}s</span>
            )}
          </div>
        ))}
      </div>

      {usage && (
        <div className="lin-status-bar">
          <span>
            ${usage.totalCost.toFixed(2)} · {formatTokens(usage.inputTokens + usage.outputTokens)}{" "}
            tok · {usage.turns}t
          </span>
        </div>
      )}

      <PermissionSheetA pending={pendingPermission} onApprove={handleApprove} onDeny={handleDeny} />

      <InputBarA
        sessionId={activeSessionId}
        disabled={!activeSessionId}
        isStreaming={isStreaming}
      />
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function ThinkingCard() {
  return (
    <div className="lin-thinking">
      <div className="lin-thinking-head">
        <span className="lin-ring" />
        <span className="lin-thinking-label">Thinking</span>
      </div>
      <div className="lin-thinking-bars">
        <span className="lin-shimmer-bar" style={{ width: "92%" }} />
        <span className="lin-shimmer-bar" style={{ width: "78%", animationDelay: "0.2s" }} />
        <span className="lin-shimmer-bar" style={{ width: "45%", animationDelay: "0.4s" }} />
      </div>
    </div>
  );
}
