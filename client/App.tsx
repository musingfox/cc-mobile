import { useEffect } from "react";
import { useAppStore } from "./stores/app-store";
import { wsService } from "./services/ws-service";
import SessionTabs from "./components/SessionTabs";
import ChatView from "./components/ChatView";
import QuickActions from "./components/QuickActions";
import PermissionBar from "./components/PermissionBar";
import InputBar from "./components/InputBar";

export default function App() {
  const connectionState = useAppStore((s) => s.connectionState);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const capabilities = useAppStore((s) => s.capabilities);

  const activeSession = activeSessionId
    ? sessions.get(activeSessionId)
    : undefined;

  useEffect(() => {
    wsService.connect();
    return () => wsService.destroy();
  }, []);


  const getStatusLabel = () => {
    switch (connectionState) {
      case "connecting":
        return "Connecting...";
      case "connected":
        return `Connected${activeSession ? ` — ${activeSession.cwd}` : ""}`;
      case "disconnected":
        return "Disconnected";
    }
  };

  const isDisabled =
    connectionState !== "connected" ||
    !activeSessionId ||
    !!activeSession?.isStreaming;

  return (
    <div className="app">
      <div className="status-bar">
        <div className={`status-dot ${connectionState}`} />
        <span>{getStatusLabel()}</span>
      </div>

      <SessionTabs />

      <ChatView
        messages={activeSession?.messages ?? []}
        isStreaming={activeSession?.isStreaming}
      />

      <QuickActions
        capabilities={capabilities}
        onCommand={(cmd) =>
          activeSessionId && wsService.sendCommand(activeSessionId, cmd)
        }
        disabled={isDisabled}
      />

      <PermissionBar
        pending={activeSession?.pendingPermission ?? null}
        onApprove={() =>
          activeSessionId && wsService.approvePermission(activeSessionId)
        }
        onDeny={() =>
          activeSessionId && wsService.denyPermission(activeSessionId)
        }
      />

      <InputBar
        onSend={(content) =>
          activeSessionId && wsService.send(activeSessionId, content)
        }
        onCommand={(cmd) =>
          activeSessionId && wsService.sendCommand(activeSessionId, cmd)
        }
        disabled={isDisabled}
        capabilities={capabilities}
      />
    </div>
  );
}
