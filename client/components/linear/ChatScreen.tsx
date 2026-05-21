import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import MarkdownRenderer from "../MarkdownRenderer";
import ActivityStrip from "./ActivityStrip";
import type { LinearScreen } from "./AppShell";
import InputBarA, { type InputBarAHandle } from "./InputBarA";
import PermissionModeSheet from "./PermissionModeSheet";
import PermissionSheetA from "./PermissionSheetA";
import PickerSheet from "./PickerSheet";
import QuickActions from "./QuickActions";
import ToolCardA from "./ToolCardA";
import "./chat.css";

const PERMISSION_MODE_LABELS: Record<string, string> = {
  default: "Default",
  auto: "Auto",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  bypassPermissions: "Bypass",
};

interface Props {
  onNavigate: (screen: LinearScreen) => void;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export default function ChatScreen({ onNavigate }: Props) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const session = useAppStore((s) =>
    activeSessionId ? s.sessions.get(activeSessionId) : undefined,
  );
  const capabilities = useAppStore((s) => s.capabilities);

  const globalPermissionMode = useSettingsStore((s) => s.permissionMode);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarAHandle>(null);
  const [pickerKind, setPickerKind] = useState<"slash" | "agent" | null>(null);
  const [permissionSheetOpen, setPermissionSheetOpen] = useState(false);

  const messages = session?.messages ?? [];
  const lastContent = messages[messages.length - 1]?.content ?? "";
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length, lastContent]);

  const handlePickerSelect = (literal: string) => {
    if (!activeSessionId) return;
    if (inputRef.current) {
      inputRef.current.insertAtCursor(literal);
      return;
    }
    setInputDraft((useAppStore.getState().inputDraft || "") + literal);
  };

  if (!activeSessionId || !session) {
    return (
      <div className="lin-chat">
        <header className="lin-chat-bar">
          <button
            type="button"
            className="lin-icon-btn"
            onClick={() => onNavigate("projects")}
            aria-label="Back to projects"
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
            onClick={() => onNavigate("projects")}
          >
            Choose a project
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
  const displayPath = session.cwd.replace(/^\/Users\/[^/]+/, "~");
  const hasOverride = session.permissionMode !== undefined;
  const effectivePermissionMode = session.permissionMode ?? globalPermissionMode;
  const permissionLabel =
    PERMISSION_MODE_LABELS[effectivePermissionMode] ?? effectivePermissionMode;

  const handleApprove = () => {
    if (activeSessionId) wsService.approvePermission(activeSessionId);
  };
  const handleDeny = () => {
    if (activeSessionId) wsService.denyPermission(activeSessionId);
  };

  const pickerItems =
    pickerKind === "slash"
      ? (capabilities?.commands ?? [])
      : pickerKind === "agent"
        ? (capabilities?.agents ?? [])
        : [];

  return (
    <div className="lin-chat">
      <header className="lin-chat-bar">
        <button
          type="button"
          className="lin-icon-btn"
          onClick={() => onNavigate("projects")}
          aria-label="Back to projects"
        >
          <Icon name="menu" size={18} color={T.fg2} />
        </button>
        <div className="lin-chat-project">
          <span className="lin-chat-status-dot" />
          <span className="lin-chat-title">{projectName}</span>
          <span className="lin-chat-path">{displayPath}</span>
        </div>
        <button
          type="button"
          className={`lin-chat-mode-chip ${hasOverride ? "is-override" : ""}`}
          onClick={() => setPermissionSheetOpen(true)}
          aria-label="Permission mode"
        >
          {permissionLabel}
        </button>
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

        {isStreaming &&
          (!currentStreamMessageId ||
            !messages.find((m) => m.id === currentStreamMessageId)?.content) && <ThinkingCard />}

        <ActivityStrip tools={activeTools} />
      </div>

      {usage && (
        <div className="lin-status-bar">
          <span>
            ${usage.totalCost.toFixed(2)} · {formatTokens(usage.inputTokens + usage.outputTokens)}{" "}
            tok · {usage.turns}t
          </span>
        </div>
      )}

      {messages.length === 0 && <QuickActions />}

      <PermissionSheetA pending={pendingPermission} onApprove={handleApprove} onDeny={handleDeny} />

      <InputBarA
        ref={inputRef}
        sessionId={activeSessionId}
        disabled={!activeSessionId}
        isStreaming={isStreaming}
        onSlashClick={() => setPickerKind("slash")}
        onAtClick={() => setPickerKind("agent")}
      />

      {pickerKind && (
        <PickerSheet
          kind={pickerKind}
          open={pickerKind !== null}
          onClose={() => setPickerKind(null)}
          onSelect={handlePickerSelect}
          loading={capabilities === null}
          items={pickerItems.map((item) => ({
            name: item.name,
            ...(item.description ? { description: item.description } : {}),
          }))}
        />
      )}

      <PermissionModeSheet
        open={permissionSheetOpen}
        onClose={() => setPermissionSheetOpen(false)}
        sessionId={activeSessionId}
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
