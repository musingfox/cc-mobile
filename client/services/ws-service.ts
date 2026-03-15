import { useAppStore } from "../stores/app-store";
import { saveProject } from "./projects";
import {
  isHookResponse,
  isHookStarted,
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

  connect() {
    const store = useAppStore.getState();
    store.setConnectionState("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      console.log("[ws-service] connected");
      useAppStore.getState().setConnectionState("connected");
      this.reconnectDelay = 1000;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
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

    this.ws = ws;
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
          saveProject(cwd);
        }
        break;
      }

      case "stream_chunk": {
        if (!sessionId) break;
        const chunk = msg.chunk as Record<string, unknown>;

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

        // Handle tool start (earliest signal)
        if (isToolStart(chunk)) {
          const { event } = chunk;
          const { content_block } = event;
          store.addActiveTool(sessionId, content_block.id, {
            toolName: content_block.name,
            startedAt: Date.now(),
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
          store.setStreaming(sessionId, false);
          store.setActiveToolStatus(sessionId, null);
          store.clearActiveTools(sessionId);
          store.clearActiveAgents(sessionId);
          store.setActiveHook(sessionId, null);
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
        }
        break;

      case "capabilities":
        store.setCapabilities({
          commands: (msg.commands as string[]) || [],
          agents: (msg.agents as string[]) || [],
          model: (msg.model as string) || "unknown",
        });
        break;

      case "error":
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
    }
  }

  createSession(cwd: string) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ type: "new_session", cwd }));
  }

  send(sessionId: string, content: string) {
    if (!this.ws) return;

    useAppStore.getState().addMessage(sessionId, {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    });

    this.ws.send(JSON.stringify({ type: "send", sessionId, content }));

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

    this.ws.send(JSON.stringify({ type: "command", sessionId, command }));

    useAppStore.getState().setStreaming(sessionId, true);
  }

  approvePermission(sessionId: string) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!this.ws || !session?.pendingPermission) return;

    this.ws.send(
      JSON.stringify({
        type: "permission",
        requestId: session.pendingPermission.requestId,
        allow: true,
      }),
    );

    useAppStore.getState().setPermission(sessionId, null);
  }

  denyPermission(sessionId: string) {
    const session = useAppStore.getState().sessions.get(sessionId);
    if (!this.ws || !session?.pendingPermission) return;

    this.ws.send(
      JSON.stringify({
        type: "permission",
        requestId: session.pendingPermission.requestId,
        allow: false,
      }),
    );

    useAppStore.getState().setPermission(sessionId, null);
  }

  closeSession(sessionId: string) {
    if (this.ws) {
      this.ws.send(JSON.stringify({ type: "interrupt", sessionId }));
    }
    useAppStore.getState().removeSession(sessionId);
  }

  listSessions(dir?: string, limit?: number, offset?: number) {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({
        type: "list_sessions",
        ...(dir && { dir }),
        ...(limit && { limit }),
        ...(offset && { offset }),
      }),
    );
  }

  resumeSession(sdkSessionId: string, cwd: string) {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({
        type: "resume_session",
        sdkSessionId,
        cwd,
      }),
    );
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
