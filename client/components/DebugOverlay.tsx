import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAppStore } from "../stores/app-store";

type WsLogEntry = {
  id: number;
  direction: "send" | "recv";
  type: string;
  data: unknown;
  timestamp: number;
};

export const debugLog = {
  entries: [] as WsLogEntry[],
  nextId: 0,
  maxEntries: 50,
  listeners: new Set<() => void>(),

  add(direction: "send" | "recv", data: unknown) {
    const type =
      typeof data === "object" && data !== null && "type" in data
        ? String((data as Record<string, unknown>).type)
        : "unknown";
    this.entries.push({
      id: this.nextId++,
      direction,
      type,
      data,
      timestamp: Date.now(),
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    for (const listener of this.listeners) listener();
  },

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

export default function DebugOverlay() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"ws" | "store">("ws");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [storeSnapshot, setStoreSnapshot] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isDebugMode = new URLSearchParams(window.location.search).get("debug") === "1";

  const wsEntries = useSyncExternalStore(debugLog.subscribe.bind(debugLog), () => debugLog.entries);

  useEffect(() => {
    if (!isDebugMode || activeTab !== "store") return;
    const interval = setInterval(() => {
      const state = useAppStore.getState();
      const snapshot = {
        connectionState: state.connectionState,
        activeSessionId: state.activeSessionId,
        sessionCount: state.sessions.size,
        activeSession: state.activeSessionId
          ? {
              id: state.activeSessionId,
              messageCount: state.sessions.get(state.activeSessionId)?.messages.length ?? 0,
              isStreaming: state.sessions.get(state.activeSessionId)?.isStreaming ?? false,
              pendingPermission: state.sessions.get(state.activeSessionId)?.pendingPermission
                ? "present"
                : "none",
              activeToolsCount: state.sessions.get(state.activeSessionId)?.activeTools.size ?? 0,
              activeAgentsCount: state.sessions.get(state.activeSessionId)?.activeAgents.size ?? 0,
              usage: state.sessions.get(state.activeSessionId)?.usage ?? null,
            }
          : null,
        permissionMode: state.permissionMode,
        capabilities: state.capabilities,
      };
      setStoreSnapshot(JSON.stringify(snapshot, null, 2));
    }, 500);
    return () => clearInterval(interval);
  }, [isDebugMode, activeTab]);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen]);

  if (!isDebugMode) return null;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  };

  const truncateJson = (data: unknown, maxLen = 80) => {
    const str = JSON.stringify(data);
    return str.length > maxLen ? `${str.slice(0, maxLen)}...` : str;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: "fixed",
          bottom: "16px",
          right: "16px",
          width: "32px",
          height: "32px",
          borderRadius: "4px",
          border: "1px solid #555",
          background: "rgba(0, 0, 0, 0.8)",
          color: "#0f0",
          fontSize: "10px",
          fontWeight: "bold",
          cursor: "pointer",
          zIndex: 9999,
          fontFamily: "monospace",
        }}
      >
        DBG
      </button>

      {isOpen && (
        <div
          style={{
            position: "fixed",
            top: "50px",
            right: "10px",
            width: "400px",
            maxHeight: "50vh",
            background: "rgba(0, 0, 0, 0.9)",
            border: "1px solid #555",
            borderRadius: "8px",
            zIndex: 9998,
            display: "flex",
            flexDirection: "column",
            fontFamily: "monospace",
            fontSize: "11px",
            color: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #555",
              padding: "4px",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("ws")}
              style={{
                flex: 1,
                padding: "6px",
                background: activeTab === "ws" ? "#333" : "transparent",
                color: activeTab === "ws" ? "#0ff" : "#888",
                border: "none",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: "11px",
              }}
            >
              WS Messages
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("store")}
              style={{
                flex: 1,
                padding: "6px",
                background: activeTab === "store" ? "#333" : "transparent",
                color: activeTab === "store" ? "#0ff" : "#888",
                border: "none",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: "11px",
              }}
            >
              Store State
            </button>
          </div>

          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "8px",
            }}
          >
            {activeTab === "ws" && (
              <div>
                {wsEntries.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      marginBottom: "8px",
                      borderBottom: "1px solid #333",
                      paddingBottom: "4px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      style={{
                        cursor: "pointer",
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        font: "inherit",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      <span style={{ color: "#666" }}>[{formatTime(entry.timestamp)}]</span>{" "}
                      <span style={{ color: entry.direction === "send" ? "#0f0" : "#0ff" }}>
                        {entry.direction === "send" ? "→" : "←"}
                      </span>{" "}
                      <span style={{ color: "#ff0" }}>{entry.type}</span>:{" "}
                      {expandedId === entry.id ? (
                        <pre
                          style={{
                            margin: "4px 0 0 0",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                            color: "#ccc",
                          }}
                        >
                          {JSON.stringify(entry.data, null, 2)}
                        </pre>
                      ) : (
                        <span style={{ color: "#aaa" }}>{truncateJson(entry.data)}</span>
                      )}
                    </button>
                  </div>
                ))}
                {wsEntries.length === 0 && (
                  <div style={{ color: "#666", textAlign: "center", padding: "20px" }}>
                    No messages yet
                  </div>
                )}
              </div>
            )}

            {activeTab === "store" && (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: "#ccc",
                }}
              >
                {storeSnapshot || "Loading..."}
              </pre>
            )}
          </div>
        </div>
      )}
    </>
  );
}
