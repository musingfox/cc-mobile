import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import MarkdownRenderer from "../MarkdownRenderer";
import ActivityStrip from "./ActivityStrip";
import type { LinearScreen } from "./AppShell";
import CompactDivider from "./CompactDivider";
import ContextUsageChip from "./ContextUsageChip";
import InputBarA, { type InputBarAHandle } from "./InputBarA";
import PermissionDeniedMarker from "./PermissionDeniedMarker";
import PermissionSheetA from "./PermissionSheetA";
import PickerSheet from "./PickerSheet";
import PromptSuggestionChip from "./PromptSuggestionChip";
import QuickActions from "./QuickActions";
import ToolCardA from "./ToolCardA";
import "./chat.css";

interface Props {
  onNavigate: (screen: LinearScreen) => void;
}

type ScrollSnapshot = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

// Misjudging "not at bottom" stops auto-scroll and breaks the primary use
// case; misjudging "at bottom" merely scrolls once more than needed, so the
// threshold errs generous. iOS reports sub-pixel scrollTop and rubber-bands
// past the end, and overscroll-behavior is unset, so exact equality would
// fail on a phone that is visually pinned.
const BOTTOM_TOLERANCE_PX = 64;

function wasNearBottom(s: ScrollSnapshot): boolean {
  return s.scrollHeight - s.scrollTop - s.clientHeight <= BOTTOM_TOLERANCE_PX;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputBarAHandle>(null);
  const [pickerKind, setPickerKind] = useState<"slash" | "agent" | null>(null);

  const messages = session?.messages ?? [];
  const lastContent = messages[messages.length - 1]?.content ?? "";

  // History is offered only where replies can be read back at all, and
  // `readable` is a snapshot value that can arrive late — an omp pane becomes
  // readable once it has written its first turn, and a kind detected later
  // becomes readable then. Nothing pushes the change, so the affordance follows
  // whatever the most recent listing said.
  const historyReadable = session?.descriptor?.readable === true;
  const pagingCursor = session?.pagingCursor ?? null;
  const historyLoading = Boolean(session?.transcriptPageRequest);

  // Every activation fetches the newest page, not just the first one: after the
  // terminal resets its conversation, re-opening the session is the only
  // gesture that re-syncs it. A same-epoch page is a visual no-op, so the
  // refetch costs a round trip and duplicates nothing. The in-flight guard
  // inside the service turns a double-tap into one request.
  useEffect(() => {
    if (!activeSessionId || !historyReadable) return;
    wsService.requestTranscriptPage(activeSessionId);
  }, [activeSessionId, historyReadable]);

  // Scroll metrics as they were before the commit that is about to happen.
  // Updated after every commit and on every user scroll, so a prepend can
  // restore the reader's position from the growth in scrollHeight, and so the
  // live-arrival gate can ask whether the reader was already at the bottom.
  const beforeCommit = useRef<ScrollSnapshot>({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
  const previousFirstId = useRef<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const firstId = messages[0]?.id;
    const previousFirst = previousFirstId.current;
    // A prepend, as opposed to a reset: the message that used to be at the top
    // is still in the list, just no longer first. An epoch reset replaces the
    // whole list, so its old first message is gone and the view belongs at the
    // bottom like any other bottom-anchored change.
    const isPrepend =
      previousFirst !== undefined &&
      firstId !== previousFirst &&
      messages.some((m) => m.id === previousFirst);
    previousFirstId.current = firstId;

    if (isPrepend) {
      el.scrollTop = beforeCommit.current.scrollTop + (el.scrollHeight - beforeCommit.current.scrollHeight);
      beforeCommit.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      return;
    }

    // First mount: previousFirst is unset, so this is not a same-conversation
    // tail — opening a session lands on the newest message.
    const isFirstMount = previousFirst === undefined;
    // Epoch reset: the first id changed and the old first is gone (otherwise
    // isPrepend would have returned). The remembered offset points into a
    // conversation that no longer exists, so the gate does not apply.
    const isEpochReset =
      previousFirst !== undefined && firstId !== previousFirst;
    const isSameConversationTail = firstId === previousFirst;
    const last = messages[messages.length - 1];
    // Own send: a local echo from the composer (role user, no recordId).
    // A transcript-borne user record still has a recordId and stays gated.
    const isOwnSend = last?.role === "user" && last.recordId === undefined;

    if (isEpochReset || isFirstMount || isOwnSend || !isSameConversationTail) {
      el.scrollTop = el.scrollHeight;
      beforeCommit.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      return;
    }

    if (!wasNearBottom(beforeCommit.current)) {
      beforeCommit.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      return;
    }

    el.scrollTop = el.scrollHeight;
    beforeCommit.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  }, [messages, lastContent]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    beforeCommit.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    if (el.scrollTop > 0) return;
    loadOlder();
  };

  const loadOlder = () => {
    // The service holds the authoritative in-flight guard; this one keeps a
    // stream of scroll events from even reaching it, and is what the loading
    // row corresponds to on screen.
    if (!activeSessionId || !historyReadable || !pagingCursor || historyLoading) return;
    wsService.requestTranscriptPage(activeSessionId, pagingCursor);
  };

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
            onClick={() => onNavigate("projectDetail")}
            aria-label="Back"
          >
            <Icon name="chevronL" size={18} color={T.fg2} />
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
  const activeAgents = session.activeAgents;
  const usage = session.usage;
  const contextUsage = session.contextUsage;
  const terminalStarting = session.terminal !== undefined && !session.terminal.ready;
  const projectName = basename(session.cwd);
  const displayPath = session.cwd.replace(/^\/Users\/[^/]+/, "~");

  const handleApprove = () => {
    if (activeSessionId) wsService.approvePermission(activeSessionId);
  };
  const handleDeny = () => {
    if (activeSessionId) wsService.denyPermission(activeSessionId);
  };
  const handleChoose = (optionId: string) => {
    if (activeSessionId) wsService.answerPermissionOption(activeSessionId, optionId);
  };

  const capState = session.capabilities;
  const pickerItems =
    capState?.status === "ready"
      ? pickerKind === "slash"
        ? capState.commands
        : pickerKind === "agent"
          ? capState.agents
          : []
      : [];

  const streamMessage = currentStreamMessageId
    ? messages.find((m) => m.id === currentStreamMessageId)
    : undefined;
  const hasStreamContent = Boolean(streamMessage?.content);
  const thinkingKind: ThinkingCardKind | null = pendingPermission
    ? "waiting-permission"
    : isStreaming && hasStreamContent
      ? "streaming"
      : isStreaming
        ? "thinking"
        : null;

  return (
    <div className="lin-chat">
      <header className="lin-chat-bar">
        <button
          type="button"
          className="lin-icon-btn"
          onClick={() => onNavigate("projectDetail")}
          aria-label="Back"
        >
          <Icon name="chevronL" size={18} color={T.fg2} />
        </button>
        <div className="lin-chat-project">
          <span className="lin-chat-status-dot" />
          <span className="lin-chat-title">{projectName}</span>
          <span className="lin-chat-path">{displayPath}</span>
        </div>
        <ContextUsageChip contextUsage={contextUsage} />
      </header>

      <div className="lin-chat-scroll lin-scroll" ref={scrollRef} onScroll={handleScroll}>
        {terminalStarting && <div className="lin-chat-empty-inline">Starting session…</div>}

        {/* Two loading rows, one string each: the first page of a session that
            has nothing on screen yet is "the conversation", anything after that
            is "earlier messages". Both suppress the scroll-triggered request
            until they resolve. */}
        {historyLoading && messages.length === 0 && (
          <div className="lin-chat-empty-inline">Loading conversation…</div>
        )}

        {historyLoading && messages.length > 0 && (
          <div className="lin-chat-empty-inline">Loading earlier messages…</div>
        )}

        {/* A cursor means the server said something older exists. It survives a
            page that rendered nothing (a run of tool plumbing), so the next
            gesture reaches further back instead of reading as "the beginning". */}
        {!historyLoading && historyReadable && pagingCursor && (
          <button type="button" className="lin-chat-load-more" onClick={loadOlder}>
            Load earlier messages
          </button>
        )}

        {messages.length === 0 && !isStreaming && !terminalStarting && !historyLoading && (
          <div className="lin-chat-empty-inline">Type a message to start.</div>
        )}

        {messages.map((m) => {
          if (m.kind === "compact_boundary") {
            return (
              <CompactDivider
                key={m.id}
                preTokens={m.compactMetadata?.preTokens}
                postTokens={m.compactMetadata?.postTokens}
              />
            );
          }
          if (m.kind === "permission_denied") {
            return (
              <PermissionDeniedMarker
                key={m.id}
                toolName={m.toolName || "unknown tool"}
                message={m.content}
              />
            );
          }
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
                agentLabel={m.agentLabel}
                agentDescription={m.agentDescription}
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

        {thinkingKind && <ThinkingCard kind={thinkingKind} />}

        <ActivityStrip
          tools={activeTools}
          agents={activeAgents}
          onStopAgent={(taskId) => {
            if (activeSessionId) wsService.stopTask(activeSessionId, taskId);
          }}
        />
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


      <PromptSuggestionChip sessionId={activeSessionId} />

      <PermissionSheetA
        pending={pendingPermission}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onChoose={handleChoose}
      />

      <InputBarA
        ref={inputRef}
        sessionId={activeSessionId}
        disabled={!activeSessionId}
        isStreaming={isStreaming}
        onSlashClick={() => {
          setPickerKind("slash");
          if (!session.capabilities) wsService.requestCapabilities(activeSessionId);
        }}
        onAtClick={() => {
          setPickerKind("agent");
          if (!session.capabilities) wsService.requestCapabilities(activeSessionId);
        }}
      />

      {pickerKind && (
        <PickerSheet
          kind={pickerKind}
          open={pickerKind !== null}
          onClose={() => setPickerKind(null)}
          onSelect={handlePickerSelect}
          loading={capState?.status === "loading"}
          {...(capState?.status === "unavailable"
            ? {
                onRetry: () => wsService.requestCapabilities(activeSessionId, { refresh: true }),
              }
            : {})}
          items={pickerItems.map((item) => ({
            name: item.name,
            ...(item.description ? { description: item.description } : {}),
          }))}
        />
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

type ThinkingCardKind = "thinking" | "streaming" | "waiting-permission";

const THINKING_LABELS: Record<ThinkingCardKind, string> = {
  thinking: "Thinking",
  streaming: "Streaming",
  "waiting-permission": "Waiting for permission",
};

const THINKING_MODIFIERS: Record<ThinkingCardKind, string> = {
  thinking: "",
  streaming: "lin-thinking--streaming",
  "waiting-permission": "lin-thinking--waiting",
};

export function ThinkingCard({ kind = "thinking" }: { kind?: ThinkingCardKind }) {
  const safeKind: ThinkingCardKind =
    kind === "streaming" || kind === "waiting-permission" ? kind : "thinking";
  const modifier = THINKING_MODIFIERS[safeKind];
  const classes = modifier ? `lin-thinking ${modifier}` : "lin-thinking";

  return (
    <div className={classes}>
      <div className="lin-thinking-head">
        <span className="lin-ring" />
        <span className="lin-thinking-label">{THINKING_LABELS[safeKind]}</span>
      </div>
      <div className="lin-thinking-bars">
        <span className="lin-shimmer-bar" style={{ width: "92%" }} />
        <span className="lin-shimmer-bar" style={{ width: "78%", animationDelay: "0.2s" }} />
        <span className="lin-shimmer-bar" style={{ width: "45%", animationDelay: "0.4s" }} />
      </div>
    </div>
  );
}
