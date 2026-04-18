import { useEffect, useRef, useState } from "react";
import type { Message, ResolvedAction } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import ActivityPanel from "../ActivityPanel";
import AnimatedMessage from "../animated/AnimatedMessage";
import PermissionBar from "../PermissionBar";
import ResolvedActionChip from "../ResolvedActionChip";
import AgentsScreen from "./AgentsScreen";
import AssistantMessage from "./AssistantMessage";
import BottomSheet from "./BottomSheet";
import CommandsScreen from "./CommandsScreen";
import MessageComposer from "./MessageComposer";
import ScreenHeader from "./ScreenHeader";
import ToolResultCard from "./ToolResultCard";
import UserMessage from "./UserMessage";

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

function getScreenTitle(session: { cwd: string } | undefined): string {
  if (!session) return "New session";
  const parts = session.cwd.split("/");
  return parts[parts.length - 1] || "New session";
}

function getScreenSubtitle(session: { cwd: string } | undefined): string | undefined {
  if (!session) return undefined;
  // TODO: Extract git branch from session state when available
  // For now, just return cwd
  return session.cwd;
}

export default function ChatScreen() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const session = useAppStore((s) =>
    activeSessionId ? s.sessions.get(activeSessionId) : undefined,
  );
  const capabilities = useAppStore((s) => s.capabilities);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);

  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [agentsSheetOpen, setAgentsSheetOpen] = useState(false);
  const [commandsSheetOpen, setCommandsSheetOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = session?.messages ?? [];
  const resolvedActions = session?.resolvedActions ?? [];
  const isStreaming = session?.isStreaming ?? false;
  const currentStreamMessageId = session?.currentStreamMessageId ?? null;
  const pendingPermission = session?.pendingPermission ?? null;
  const activeTools = session?.activeTools ?? new Map();
  const activeAgents = session?.activeAgents ?? new Map();
  const activeHook = session?.activeHook ?? null;
  const promptSuggestion = session?.promptSuggestion ?? null;

  const hasActivity = activeTools.size > 0 || activeAgents.size > 0 || activeHook;

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [autoScroll]);

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

  const handleApprove = () => {
    if (!activeSessionId || !pendingPermission) return;
    useAppStore.getState().setPermission(activeSessionId, null);
    // Send approval via wsService
    import("../../services/ws-service").then(({ wsService }) => {
      wsService.respondToPermission(pendingPermission.requestId, "approve");
    });
  };

  const handleDeny = () => {
    if (!activeSessionId || !pendingPermission) return;
    useAppStore.getState().setPermission(activeSessionId, null);
    import("../../services/ws-service").then(({ wsService }) => {
      wsService.respondToPermission(pendingPermission.requestId, "deny");
    });
  };

  const handleAnswer = (answers: Record<string, string>) => {
    if (!activeSessionId || !pendingPermission) return;
    useAppStore.getState().setPermission(activeSessionId, null);
    import("../../services/ws-service").then(({ wsService }) => {
      wsService.respondToPermission(pendingPermission.requestId, "answer", answers);
    });
  };

  const handleSuggestionClick = () => {
    if (!promptSuggestion || !activeSessionId) return;
    import("../../services/ws-service").then(({ wsService }) => {
      wsService.send({
        type: "send",
        sessionId: activeSessionId,
        content: promptSuggestion,
      });
    });
    useAppStore.getState().setPromptSuggestion(activeSessionId, null);
  };

  const handleAgentSelectInSheet = (agentName: string) => {
    useAppStore.getState().setInputDraft(`@${agentName} `);
    setAgentsSheetOpen(false);
  };

  const handleCommandSelectInSheet = (commandName: string) => {
    useAppStore.getState().setInputDraft(`${commandName} `);
    setCommandsSheetOpen(false);
  };

  // Empty state when no active session
  if (!activeSessionId || !session) {
    return (
      <>
        <ScreenHeader title="New session" />
        <div className="ember-chat-empty">
          <div className="ember-chat-empty-message">Create or select a session</div>
          <button
            type="button"
            className="ember-chat-empty-button"
            onClick={() => setActiveScreen("sessions")}
          >
            Go to Sessions
          </button>
        </div>
        <MessageComposer
          sessionId={null}
          disabled={true}
          onOpenAgents={() => setAgentsSheetOpen(true)}
          onOpenCommands={() => setCommandsSheetOpen(true)}
          capabilities={capabilities}
        />
      </>
    );
  }

  const timeline = buildTimeline(messages, resolvedActions);

  return (
    <>
      <ScreenHeader
        title={getScreenTitle(session)}
        subtitle={getScreenSubtitle(session)}
        rightSlot={
          <div className="ember-status-info-compact">
            {session.usage && (
              <>
                <span>${session.usage.totalCost.toFixed(4)}</span>
                <span className="ember-status-info-sep">·</span>
                <span>{session.usage.turns}t</span>
              </>
            )}
          </div>
        }
      />
      <div className="ember-chat-timeline" ref={scrollRef} onScroll={handleScroll}>
        {timeline.length === 0 && !isStreaming && (
          <div className="ember-chat-empty-timeline">
            <div className="ember-chat-empty-message">Type a message to start</div>
          </div>
        )}
        {timeline.map((item, timelineIdx) => {
          const isLastAssistant =
            isStreaming &&
            item.kind === "message" &&
            item.data.role === "assistant" &&
            item.data.id === currentStreamMessageId;

          return item.kind === "action" ? (
            <AnimatedMessage key={item.data.id} index={0} className="ember-resolved-action-row">
              <ResolvedActionChip action={item.data} />
            </AnimatedMessage>
          ) : (
            <AnimatedMessage
              key={item.data.id}
              index={item.index}
              className={`ember-timeline-item`}
              isStreaming={isLastAssistant}
            >
              {item.data.role === "tool" ? (
                <ToolResultCard
                  toolName={item.data.toolName || "Unknown"}
                  input={item.data.toolInput || {}}
                  result={item.data.content}
                  expanded={expandedTools.has(item.data.id)}
                  onToggle={() => toggleToolExpanded(item.data.id)}
                />
              ) : item.data.role === "user" ? (
                <UserMessage
                  content={item.data.content}
                  timestamp={item.data.timestamp}
                  contentBlocks={item.data.contentBlocks}
                />
              ) : (
                <AssistantMessage
                  content={item.data.content}
                  timestamp={item.data.timestamp}
                  isStreaming={isLastAssistant}
                />
              )}
            </AnimatedMessage>
          );
        })}
        {hasActivity && (
          <ActivityPanel
            activeTools={activeTools}
            activeAgents={activeAgents}
            activeHook={activeHook}
          />
        )}
      </div>
      <PermissionBar
        pending={pendingPermission}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onAnswer={handleAnswer}
      />
      {promptSuggestion && (
        <button
          type="button"
          className="ember-prompt-suggestion-chip"
          onClick={handleSuggestionClick}
        >
          <span className="ember-prompt-suggestion-label">Suggested:</span>
          <span className="ember-prompt-suggestion-text">{promptSuggestion}</span>
        </button>
      )}
      <MessageComposer
        sessionId={activeSessionId}
        disabled={false}
        onOpenAgents={() => setAgentsSheetOpen(true)}
        onOpenCommands={() => setCommandsSheetOpen(true)}
        capabilities={capabilities}
      />
      <BottomSheet open={agentsSheetOpen} onClose={() => setAgentsSheetOpen(false)} title="Agents">
        <AgentsScreen variant="sheet" onSelect={handleAgentSelectInSheet} />
      </BottomSheet>
      <BottomSheet
        open={commandsSheetOpen}
        onClose={() => setCommandsSheetOpen(false)}
        title="Commands"
      >
        <CommandsScreen variant="sheet" onSelect={handleCommandSelectInSheet} />
      </BottomSheet>
    </>
  );
}
