import { useSocket } from "./hooks/useSocket";
import ChatView from "./components/ChatView";
import QuickActions from "./components/QuickActions";
import PermissionBar from "./components/PermissionBar";
import InputBar from "./components/InputBar";

export default function App() {
  const {
    state,
    messages,
    pendingPermission,
    isStreaming,
    capabilities,
    send,
    sendCommand,
    approvePermission,
    denyPermission,
  } = useSocket();

  const getStatusLabel = () => {
    switch (state) {
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Disconnected";
    }
  };

  return (
    <div className="app">
      <div className="status-bar">
        <div className={`status-dot ${state}`} />
        <span>{getStatusLabel()}</span>
      </div>

      <ChatView messages={messages} isStreaming={isStreaming} />

      <QuickActions
        capabilities={capabilities}
        onCommand={sendCommand}
        disabled={state !== "connected" || isStreaming}
      />

      <PermissionBar
        pending={pendingPermission}
        onApprove={approvePermission}
        onDeny={denyPermission}
      />

      <InputBar onSend={send} disabled={state !== "connected" || isStreaming} />
    </div>
  );
}
