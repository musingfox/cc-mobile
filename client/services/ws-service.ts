import type { ContentBlock } from "../../server/protocol";
import { debugLog } from "../components/DebugOverlay";
import { type Capabilities, useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";
import { hapticService } from "./haptic";
import { notificationService } from "./notification";
import { saveProject } from "./projects";
import { toastService } from "./toast-service";
import {
  isApiRetry,
  isHookResponse,
  isHookStarted,
  isPromptSuggestion,
  isRateLimitEvent,
  isResultMessage,
  isTaskNotification,
  isTaskProgress,
  isTaskStarted,
  isToolProgress,
  isToolStart,
  isToolUseSummary,
} from "./tool-events";

export function extractTextFromChunk(chunk: Record<string, unknown>): string | null {
  if (chunk.type === "assistant") {
    const message = chunk.message as
      | { content?: Array<{ type: string; text?: string }> }
      | undefined;
    if (!message?.content) return null;
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return text || null;
  }

  if (chunk.type === "stream_event") {
    const event = chunk.event as Record<string, unknown> | undefined;
    if (!event) return null;

    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) return null;

      if (delta.type === "text_delta") {
        return (delta.text as string) ?? null;
      }
    }
  }

  return null;
}

class WsService {
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectDelay = 1000;
  private lastToolBatchTime = 0;
  private lastEventId: number | null = null;
  private pendingResumeSdkSessionId: string | null = null;

  private sendMessage(msg: Record<string, unknown>) {
    if (!this.ws) return;
    debugLog.add("send", msg);
    this.ws.send(JSON.stringify(msg));
  }

  connect() {
    const store = useAppStore.getState();
    store.setConnectionState("connecting");

    // Restore lastEventId from localStorage
    try {
      const stored = localStorage.getItem("ccm:lastEventId");
      if (stored && this.lastEventId === null) {
        this.lastEventId = parseInt(stored, 10);
      }
    } catch {}

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const basePath = (window as typeof window & { __BASE_PATH__?: string }).__BASE_PATH__ || "";
    const ws = new WebSocket(`${protocol}//${window.location.host}${basePath}/ws`);

    ws.onopen = () => {
      console.log("[ws-service] connected");
      const store = useAppStore.getState();
      store.setConnectionState("connected");
      this.reconnectDelay = 1000;
      this.ws = ws;
      // Request current server config (including permission mode)
      this.sendMessage({ type: "get_server_config" });
      // Restore persisted preferences to server
      const settings = useSettingsStore.getState();
      this.setEnvVars(settings.envVars);
      this.setModel(settings.model);
      this.setEffort(settings.effort as "low" | "medium" | "high" | "max" | null);
      if (settings.permissionMode !== "default") {
        this.setPermissionMode(settings.permissionMode);
      }

      // Send reconnect message if we have lastEventId
      if (this.lastEventId !== null) {
        const sessionIds = Array.from(useAppStore.getState().sessions.keys());
        if (sessionIds.length > 0) {
          this.sendMessage({ type: "reconnect", lastEventId: this.lastEventId, sessionIds });
        }
      }

      // If we have restored sessions, don't auto-create a new one
      // User already has sessions from persistence
      if (store.sessions.size === 0) {
        // No restored sessions - this is first load or clean state
        // Auto-create will happen via other mechanisms if needed
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        debugLog.add("recv", msg);

        // Handle event envelope — unwrap and track eventId
        if (msg.type === "event") {
          this.lastEventId = msg.eventId;
          // Save to localStorage for persistence across page reloads
          try {
            localStorage.setItem("ccm:lastEventId", String(msg.eventId));
          } catch {}
          this.handleMessage(msg.payload);
          return;
        }

        // Handle ping — respond with pong
        if (msg.type === "ping") {
          this.sendMessage({ type: "pong" });
          return;
        }

        // Handle replay_complete
        if (msg.type === "replay_complete") {
          console.log(
            `[ws-service] replay complete: session=${msg.sessionId}, events=${msg.eventsReplayed}, gap=${msg.gapDetected}`,
          );
          if (msg.gapDetected) {
            toastService.info("Some messages may have been missed during reconnect");
          }
          return;
        }

        // All other messages (non-wrapped) go through handleMessage directly
        this.handleMessage(msg);
      } catch (err) {
        console.error("[ws-service] parse error:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("[ws-service] error:", error);
    };

    ws.onclose = () => {
      console.log("[ws-service] disconnected");
      useAppStore.getState().setConnectionState("disconnected");
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(this.reconnectDelay, 30000);
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectDelay = Math.min(delay * 2, 30000);
      this.connect();
    }, delay);
  }

  private handleMessage(msg: Record<string, unknown>) {
    const store = useAppStore.getState();
    const sessionId = msg.sessionId as string | undefined;

    switch (msg.type) {
      case "session_created": {
        const cwd = (msg.cwd as string) || "/";
        if (sessionId) {
          // Replace current session if it's empty
          const activeId = store.activeSessionId;
          if (activeId) {
            const activeSession = store.sessions.get(activeId);
            if (activeSession && activeSession.messages.length === 0) {
              store.removeSession(activeId);
            }
          }
          store.addSession(sessionId, cwd);
          // If this was a resume, store the sdkSessionId
          if (this.pendingResumeSdkSessionId) {
            store.setSdkSessionId(sessionId, this.pendingResumeSdkSessionId);
            this.pendingResumeSdkSessionId = null;
          }
          saveProject(cwd);
        }
        break;
      }

      case "stream_chunk": {
        if (!sessionId) break;
        const chunk = msg.chunk as Record<string, unknown>;

        // Capture sdkSessionId from system/init message
        if (chunk.type === "system" && chunk.subtype === "init" && chunk.session_id) {
          store.setSdkSessionId(sessionId, chunk.session_id as string);
        }

        // Handle hook started — clear stale tools since hooks run after turn completes
        if (isHookStarted(chunk)) {
          store.clearActiveTools(sessionId);
          store.clearActiveAgents(sessionId);
          store.setActiveToolStatus(sessionId, null);
          store.setActiveHook(sessionId, { hookId: chunk.hook_id, hookName: chunk.hook_name });
          break;
        }

        // Handle hook response
        if (isHookResponse(chunk)) {
          store.setActiveHook(sessionId, null);
          break;
        }

        // Handle rate limit events
        if (isRateLimitEvent(chunk)) {
          store.setRateLimitInfo(chunk.rate_limit_info);
          break;
        }

        // Handle API retry notifications
        if (isApiRetry(chunk)) {
          const delaySec = Math.round(chunk.retry_delay_ms / 1000);
          toastService.info(
            `API retrying (${chunk.attempt}/${chunk.max_retries}) in ${delaySec}s...`,
          );
          break;
        }

        // Handle prompt suggestions
        if (isPromptSuggestion(chunk)) {
          if (sessionId) {
            store.setPromptSuggestion(sessionId, chunk.suggestion);
          }
          break;
        }

        // Handle result messages (cost/token data)
        // Result marks end of turn — clear stale tool/agent state
        if (isResultMessage(chunk)) {
          store.updateUsage(sessionId, {
            totalCost: chunk.total_cost_usd ?? 0,
            inputTokens: chunk.usage?.input_tokens ?? 0,
            outputTokens: chunk.usage?.output_tokens ?? 0,
            cacheReadTokens: chunk.usage?.cache_read_input_tokens ?? 0,
            cacheCreationTokens: chunk.usage?.cache_creation_input_tokens ?? 0,
            turns: chunk.num_turns ?? 0,
            durationMs: chunk.duration_ms ?? 0,
          });
          store.clearActiveTools(sessionId);
          store.clearActiveAgents(sessionId);
          store.setActiveToolStatus(sessionId, null);
          break;
        }

        // When the model starts producing text, all tools are done
        if (
          chunk.type === "stream_event" &&
          (chunk.event as Record<string, unknown>)?.type === "content_block_start" &&
          ((chunk.event as Record<string, unknown>)?.content_block as Record<string, unknown>)
            ?.type === "text"
        ) {
          store.clearActiveTools(sessionId);
          store.setActiveToolStatus(sessionId, null);
        }

        // Handle tool start (earliest signal)
        if (isToolStart(chunk)) {
          const { event } = chunk;
          const { content_block } = event;
          const now = Date.now();

          // Detect new tool batch: if >200ms since last tool start,
          // this is a new sequential tool (not parallel). Clean up
          // stale root tools from the previous batch, since tool_use_summary
          // may not reliably fire for every tool.
          if (now - this.lastToolBatchTime > 200) {
            const session = store.sessions.get(sessionId);
            if (session) {
              for (const [toolId, tool] of session.activeTools) {
                if (!tool.parentToolUseId) {
                  store.removeActiveTool(sessionId, toolId);
                }
              }
            }
          }
          this.lastToolBatchTime = now;

          store.addActiveTool(sessionId, content_block.id, {
            toolName: content_block.name,
            startedAt: now,
          });
          store.setActiveToolStatus(sessionId, {
            toolName: content_block.name,
            description: content_block.name,
          });
          break;
        }

        // Handle tool progress updates
        if (isToolProgress(chunk)) {
          if (chunk.tool_use_id) {
            store.updateActiveTool(sessionId, chunk.tool_use_id, {
              ...(chunk.elapsed_time_seconds !== undefined && {
                elapsedSeconds: chunk.elapsed_time_seconds,
              }),
              ...(chunk.parent_tool_use_id !== undefined && {
                parentToolUseId: chunk.parent_tool_use_id,
              }),
            });
          }
          // Maintain backward compatibility
          store.setActiveToolStatus(sessionId, {
            toolName: chunk.tool_name,
            description: chunk.tool_name,
          });
          break;
        }

        // Handle tool completion summary
        if (isToolUseSummary(chunk)) {
          const session = store.sessions.get(sessionId);
          const toolName = session?.activeToolStatus?.toolName ?? "Tool";
          store.addToolMessage(sessionId, toolName, chunk.summary);
          // Remove all completed tools
          if (Array.isArray(chunk.preceding_tool_use_ids)) {
            chunk.preceding_tool_use_ids.forEach((id) => {
              store.removeActiveTool(sessionId, id);
            });
          }
          // Clear legacy status
          store.setActiveToolStatus(sessionId, null);
          break;
        }

        // Handle agent/task started
        if (isTaskStarted(chunk)) {
          store.addActiveAgent(sessionId, chunk.task_id, {
            description: chunk.description,
            taskType: chunk.task_type,
            status: "running",
          });
          break;
        }

        // Handle agent/task progress
        if (isTaskProgress(chunk)) {
          if (chunk.task_id) {
            store.updateActiveAgent(sessionId, chunk.task_id, {
              toolCount: chunk.usage?.tool_uses,
              tokenCount: chunk.usage?.total_tokens,
              summary: chunk.summary,
            });
          }
          // Update legacy status if tool name present
          if (chunk.last_tool_name) {
            store.setActiveToolStatus(sessionId, {
              toolName: chunk.last_tool_name,
              description: chunk.description,
            });
          }
          break;
        }

        // Handle agent/task completion
        if (isTaskNotification(chunk)) {
          store.completeActiveAgent(sessionId, chunk.task_id, {
            status: chunk.status,
            summary: chunk.summary,
            toolCount: chunk.usage?.tool_uses,
            tokenCount: chunk.usage?.total_tokens,
          });
          break;
        }

        // Extract tool input from assistant messages for ActivityPanel display.
        // Also clean up stale tools from previous turns: an `assistant` chunk
        // signals a new turn, so any active tools NOT listed in this message's
        // content are leftovers that the SDK already finished executing.
        if (chunk.type === "assistant") {
          const message = chunk.message as { content?: Array<Record<string, unknown>> } | undefined;
          const currentTurnToolIds = new Set<string>();
          if (message?.content) {
            for (const block of message.content) {
              if (block.type === "tool_use" && typeof block.id === "string") {
                currentTurnToolIds.add(block.id);
                if (block.input) {
                  store.updateActiveTool(sessionId, block.id as string, {
                    input: block.input as Record<string, unknown>,
                  });
                }
              }
            }
          }
          // Remove tools from previous turns
          const session = store.sessions.get(sessionId);
          if (session) {
            for (const [toolId, tool] of session.activeTools) {
              if (!currentTurnToolIds.has(toolId) && !tool.parentToolUseId) {
                store.removeActiveTool(sessionId, toolId);
              }
            }
          }
        }

        const text = extractTextFromChunk(chunk);
        if (!text) break;

        const session = store.sessions.get(sessionId);
        if (!session) break;

        store.setStreaming(sessionId, true);

        // Handle stream_event chunks: create/append incrementally
        if (chunk.type === "stream_event") {
          if (session.currentStreamMessageId) {
            store.appendToLastAssistantMessage(sessionId, text);
          } else {
            const newId = `msg-${Date.now()}-${Math.random()}`;
            store.startStreamMessage(sessionId, newId, text);
          }
        }
        // Handle assistant messages: dedup if already streamed
        else if (chunk.type === "assistant") {
          // Dedup: skip if this is the final message matching the current stream
          if (session.currentStreamMessageId) {
            const lastMsg = session.messages[session.messages.length - 1];
            if (lastMsg?.id === session.currentStreamMessageId && lastMsg.content === text) {
              break;
            }
          }
          // Not a duplicate: create new message
          const newId = `msg-${Date.now()}-${Math.random()}`;
          store.addMessage(sessionId, {
            id: newId,
            role: "assistant",
            content: text,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case "stream_end":
        if (sessionId) {
          // Snapshot completed activity before clearing
          const endSession = store.sessions.get(sessionId);
          if (endSession) {
            const completedTools = Array.from(endSession.activeTools.values());
            const completedAgents = Array.from(endSession.activeAgents.values()).filter(
              (a) => a.status !== "running",
            );
            if (completedTools.length > 0 || completedAgents.length > 0) {
              store.addResolvedAction(sessionId, {
                id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                type: "activity",
                timestamp: Date.now(),
                tools: completedTools.map((t) => ({
                  toolName: t.toolName,
                  elapsed: t.elapsedSeconds ? `${Math.floor(t.elapsedSeconds)}s` : undefined,
                })),
                agents: completedAgents.map((a) => ({
                  description: a.description,
                  toolCount: a.toolCount,
                  tokenCount: a.tokenCount,
                })),
              });
            }
          }

          store.setStreaming(sessionId, false);
          store.setActiveToolStatus(sessionId, null);
          store.clearActiveTools(sessionId);
          store.clearActiveAgents(sessionId);
          store.setActiveHook(sessionId, null);
          hapticService.complete();
          // Notify when response completes while app is in background
          if (document.hidden) {
            const settingsStore = useSettingsStore.getState();
            if (settingsStore.notificationsEnabled) {
              const cwd = store.sessions.get(sessionId)?.cwd;
              notificationService.showResponseComplete(sessionId, cwd);
            }
          }
        }
        break;

      case "permission_request":
        if (sessionId) {
          store.setPermission(sessionId, {
            requestId: msg.requestId as string,
            tool: msg.tool as {
              name: string;
              parameters: Record<string, unknown>;
            },
          });
          // Background notification when page is hidden
          const settingsStore = useSettingsStore.getState();
          const toolName = (msg.tool as { name: string }).name;
          if (document.hidden) {
            toastService.info(`Permission requested: ${toolName}`);
            if (settingsStore.notificationsEnabled) {
              const cwd = store.sessions.get(sessionId)?.cwd;
              notificationService.showPermissionNotification(toolName, sessionId, cwd);
            }
          }
        }
        break;

      case "capabilities":
        store.setCapabilities({
          commands: (msg.commands as string[]) || [],
          agents: (msg.agents as string[]) || [],
          model: (msg.model as string) || "unknown",
          ...(msg.models ? { models: msg.models as Capabilities["models"] } : {}),
          ...(msg.accountInfo
            ? { accountInfo: msg.accountInfo as Capabilities["accountInfo"] }
            : {}),
        });
        break;

      case "error":
        hapticService.error();
        // Clear directory loading state on any error
        store.setIsLoadingDirectories(false);

        // Auto-resume if server lost the session (e.g. after server restart)
        if (
          sessionId &&
          msg.code === "session_error" &&
          typeof msg.message === "string" &&
          msg.message.includes("not found")
        ) {
          const session = store.sessions.get(sessionId);
          if (session?.sdkSessionId) {
            console.log(
              `[ws-service] session lost on server, auto-resuming: ${session.sdkSessionId}`,
            );
            toastService.info("Reconnecting to session...");
            // Remove stale session, resume will create a new one
            store.removeSession(sessionId);
            this.resumeSession(session.sdkSessionId, session.cwd);
            break;
          }
        }

        if (sessionId) {
          store.addMessage(sessionId, {
            id: `error-${Date.now()}`,
            role: "assistant",
            content: `Error: ${msg.message}`,
            timestamp: Date.now(),
          });
          store.setStreaming(sessionId, false);
        } else {
          store.setGlobalError(msg.message as string);
          toastService.error(msg.message as string);
        }
        break;

      case "session_list": {
        // Store session list in app store
        store.setSessionList(
          (msg.sessions as Array<{
            sdkSessionId: string;
            displayTitle: string;
            cwd: string;
            gitBranch?: string;
            lastModified: number;
            createdAt?: number;
          }>) || [],
        );
        break;
      }

      case "server_config": {
        const config = msg.config as {
          permissionMode?: string;
          model?: string;
          effort?: string | null;
          allowedRoots?: string[] | null;
          homeDirectory?: string;
        };
        const settingsStore = useSettingsStore.getState();
        if (config?.permissionMode) {
          store.setPermissionMode(config.permissionMode);
          settingsStore.setPermissionMode(config.permissionMode);
        }
        if (config?.model) {
          store.setSelectedModel(config.model);
          settingsStore.setModel(config.model);
        }
        if (config?.effort !== undefined) {
          store.setSelectedEffort(config.effort);
          settingsStore.setEffort(config.effort);
        }
        if (config?.allowedRoots !== undefined || config?.homeDirectory) {
          store.setServerPaths({
            allowedRoots: config.allowedRoots ?? null,
            homeDirectory: config.homeDirectory ?? "~",
          });
        }
        break;
      }

      case "session_history": {
        if (sessionId) {
          const messages =
            (msg.messages as Array<{
              id: string;
              role: string;
              content: string;
              timestamp: number;
            }>) || [];
          store.loadSessionHistory(sessionId, messages);
        }
        break;
      }

      case "directory_listing": {
        store.setDirectoryListing({
          path: msg.path as string,
          entries: (msg.entries as Array<{ name: string; path: string }>) || [],
          parent: (msg.parent as string | null) ?? null,
        });
        store.setIsLoadingDirectories(false);
        break;
      }
    }
  }

  createSession(cwd: string) {
    if (!this.ws) return;
    this.sendMessage({ type: "new_session", cwd });
  }

  send(sessionId: string, content: string | ContentBlock[]) {
    if (!this.ws) return;

    // For display purposes, extract text from content blocks
    let displayContent: string;
    let contentBlocks: ContentBlock[] | undefined;

    if (typeof content === "string") {
      displayContent = content;
    } else {
      // Extract text blocks and join them
      const textBlocks = content.filter((block) => block.type === "text");
      displayContent = textBlocks.map((block) => block.text).join("\n");
      contentBlocks = content;
    }

    useAppStore.getState().addMessage(sessionId, {
      id: `user-${Date.now()}`,
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
      contentBlocks,
    });

    this.sendMessage({ type: "send", sessionId, content });

    useAppStore.getState().setStreaming(sessionId, true);
  }

  sendCommand(sessionId: string, command: string) {
    if (!this.ws) return;

    useAppStore.getState().addMessage(sessionId, {
      id: `cmd-${Date.now()}`,
      role: "user",
      content: command,
      timestamp: Date.now(),
    });

    this.sendMessage({ type: "command", sessionId, command });

    useAppStore.getState().setStreaming(sessionId, true);
  }

  private recordPermissionAction(
    sessionId: string,
    resolution: "approved" | "denied" | "answered",
    answers?: Record<string, string>,
  ) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!session?.pendingPermission) return;
    const { tool } = session.pendingPermission;
    const answerSummary = answers
      ? Object.entries(answers)
          .map(([q, a]) => `${q}: ${a}`)
          .join(", ")
      : undefined;
    useAppStore.getState().addResolvedAction(sessionId, {
      id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "permission",
      timestamp: Date.now(),
      toolName: tool.name,
      parameters: tool.parameters,
      resolution,
      ...(answerSummary ? { answer: answerSummary } : {}),
    });
  }

  approvePermission(sessionId: string) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!this.ws || !session?.pendingPermission) return;

    this.sendMessage({
      type: "permission",
      requestId: session.pendingPermission.requestId,
      allow: true,
    });

    this.recordPermissionAction(sessionId, "approved");
    useAppStore.getState().setPermission(sessionId, null);
  }

  denyPermission(sessionId: string) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!this.ws || !session?.pendingPermission) return;

    this.sendMessage({
      type: "permission",
      requestId: session.pendingPermission.requestId,
      allow: false,
    });

    this.recordPermissionAction(sessionId, "denied");
    useAppStore.getState().setPermission(sessionId, null);
  }

  answerPermission(sessionId: string, answers: Record<string, string>) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!this.ws || !session?.pendingPermission) return;

    this.sendMessage({
      type: "permission",
      requestId: session.pendingPermission.requestId,
      allow: true,
      answers,
    });

    this.recordPermissionAction(sessionId, "answered", answers);
    useAppStore.getState().setPermission(sessionId, null);
  }

  closeSession(sessionId: string) {
    if (this.ws) {
      this.sendMessage({ type: "interrupt", sessionId });
    }
    useAppStore.getState().removeSession(sessionId);
  }

  listSessions(dir?: string, limit?: number, offset?: number) {
    if (!this.ws) return;
    this.sendMessage({
      type: "list_sessions",
      ...(dir && { dir }),
      ...(limit && { limit }),
      ...(offset && { offset }),
    });
  }

  resumeSession(sdkSessionId: string, cwd: string) {
    if (!this.ws) return;
    this.pendingResumeSdkSessionId = sdkSessionId;
    this.sendMessage({
      type: "resume_session",
      sdkSessionId,
      cwd,
    });
  }

  setPermissionMode(mode: string) {
    if (!this.ws) return;
    this.sendMessage({ type: "set_permission_mode", mode });
  }

  setModel(model: string, sessionId?: string) {
    if (!this.ws) return;
    this.sendMessage({ type: "set_model", model, ...(sessionId && { sessionId }) });
  }

  setEffort(effort: "low" | "medium" | "high" | "max" | null) {
    if (!this.ws) return;
    this.sendMessage({ type: "set_effort", effort });
  }

  setEnvVars(envVars: Record<string, string>) {
    if (!this.ws) return;
    this.sendMessage({ type: "set_env_vars", envVars });
  }

  listDirectories(path: string) {
    if (!this.ws) return;
    useAppStore.getState().setIsLoadingDirectories(true);
    this.sendMessage({ type: "list_directories", path });
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  destroy() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
    }
  }
}

export const wsService = new WsService();
