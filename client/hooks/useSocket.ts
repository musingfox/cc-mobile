import { useState, useEffect, useRef, useCallback } from "react";

// Local types (avoid importing server code into client bundle)
export type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
};

export type PendingPermission = {
  requestId: string;
  tool: {
    name: string;
    parameters: Record<string, unknown>;
  };
};

type SocketState = "connecting" | "connected" | "disconnected";

/**
 * Extract displayable text from an SDK stream chunk.
 * Returns null if the chunk should be skipped (system events, results, etc.)
 */
export function extractTextFromChunk(chunk: Record<string, unknown>): string | null {
  if (chunk.type === "assistant") {
    const message = chunk.message as { content?: Array<{ type: string; text?: string }> } | undefined;
    if (!message?.content) return null;
    const text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return text || null;
  }
  // system, rate_limit_event, result, etc — skip
  return null;
}

export function useSocket() {
  const [state, setState] = useState<SocketState>("connecting");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingPermission, setPendingPermission] =
    useState<PendingPermission | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef(1000);
  const currentStreamMessageIdRef = useRef<string | null>(null);

  const connect = useCallback(() => {
    setState("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connected");
      setState("connected");
      reconnectDelayRef.current = 1000; // Reset backoff

      // Send new_session message
      ws.send(
        JSON.stringify({
          type: "new_session",
          cwd: "/",
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "session_created":
            setSessionId(msg.sessionId);
            setState("connected");
            break;

          case "stream_chunk": {
            const text = extractTextFromChunk(msg.chunk);
            if (!text) break;

            setIsStreaming(true);
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              const streamId = currentStreamMessageIdRef.current;

              if (
                streamId &&
                lastMsg?.id === streamId &&
                lastMsg.role === "assistant"
              ) {
                return [
                  ...prev.slice(0, -1),
                  { ...lastMsg, content: lastMsg.content + text },
                ];
              }

              const newId = `msg-${Date.now()}-${Math.random()}`;
              currentStreamMessageIdRef.current = newId;
              return [
                ...prev,
                {
                  id: newId,
                  role: "assistant",
                  content: text,
                  timestamp: Date.now(),
                },
              ];
            });
            break;
          }

          case "stream_end":
            setIsStreaming(false);
            currentStreamMessageIdRef.current = null;
            break;

          case "permission_request":
            setPendingPermission({
              requestId: msg.requestId,
              tool: msg.tool,
            });
            break;

          case "error":
            setMessages((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                role: "assistant",
                content: `Error: ${msg.message}`,
                timestamp: Date.now(),
              },
            ]);
            setIsStreaming(false);
            break;

          default:
            // Ignore other message types
            break;
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      setState("disconnected");
      wsRef.current = null;

      // Attempt reconnect with exponential backoff
      const delay = Math.min(reconnectDelayRef.current, 30000);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
        connect();
      }, delay);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback(
    (content: string) => {
      if (!wsRef.current || !sessionId) return;

      // Add user message locally
      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Send to server
      wsRef.current.send(
        JSON.stringify({
          type: "send",
          sessionId,
          content,
        })
      );

      setIsStreaming(true);
    },
    [sessionId]
  );

  const approvePermission = useCallback(() => {
    if (!wsRef.current || !pendingPermission) return;

    wsRef.current.send(
      JSON.stringify({
        type: "permission",
        requestId: pendingPermission.requestId,
        allow: true,
      })
    );

    setPendingPermission(null);
  }, [pendingPermission]);

  const denyPermission = useCallback(() => {
    if (!wsRef.current || !pendingPermission) return;

    wsRef.current.send(
      JSON.stringify({
        type: "permission",
        requestId: pendingPermission.requestId,
        allow: false,
      })
    );

    setPendingPermission(null);
  }, [pendingPermission]);

  return {
    state,
    sessionId,
    messages,
    pendingPermission,
    isStreaming,
    send,
    approvePermission,
    denyPermission,
  };
}
