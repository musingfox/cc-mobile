import { useAppStore } from "../stores/app-store";

export function extractTextFromChunk(
  chunk: Record<string, unknown>
): string | null {
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
      case "session_created":
        if (sessionId) {
          // Find pending cwd for this session
          const pendingCwd =
            (this as any)._pendingCwd ?? "/";
          delete (this as any)._pendingCwd;
          store.addSession(sessionId, pendingCwd);
        }
        break;

      case "stream_chunk": {
        if (!sessionId) break;
        const text = extractTextFromChunk(
          msg.chunk as Record<string, unknown>
        );
        if (!text) break;

        const session = store.sessions.get(sessionId);
        if (!session) break;

        store.setStreaming(sessionId, true);

        if (session.currentStreamMessageId) {
          store.appendToLastAssistantMessage(sessionId, text);
        } else {
          const newId = `msg-${Date.now()}-${Math.random()}`;
          store.startStreamMessage(sessionId, newId, text);
        }
        break;
      }

      case "stream_end":
        if (sessionId) {
          store.setStreaming(sessionId, false);
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
        }
        break;
    }
  }

  createSession(cwd: string) {
    if (!this.ws) return;
    (this as any)._pendingCwd = cwd;
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

    this.ws.send(
      JSON.stringify({ type: "send", sessionId, content })
    );

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

    this.ws.send(
      JSON.stringify({ type: "command", sessionId, command })
    );

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
      })
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
      })
    );

    useAppStore.getState().setPermission(sessionId, null);
  }

  closeSession(sessionId: string) {
    if (this.ws) {
      this.ws.send(
        JSON.stringify({ type: "interrupt", sessionId })
      );
    }
    useAppStore.getState().removeSession(sessionId);
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
