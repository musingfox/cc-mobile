import { useEffect, useState } from "react";
import { useAppStore } from "./stores/app-store";
import { useSettingsStore } from "./stores/settings-store";
import { wsService } from "./services/ws-service";
import SessionTabs from "./components/SessionTabs";
import ChatView from "./components/ChatView";
import QuickActions from "./components/QuickActions";
import PermissionBar from "./components/PermissionBar";
import InputBar from "./components/InputBar";
import Settings from "./components/Settings";
import SessionListModal from "./components/SessionListModal";
import StatusBar from "./components/StatusBar";
import PickerPanel from "./components/PickerPanel";

export default function App() {
  const connectionState = useAppStore((s) => s.connectionState);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const capabilities = useAppStore((s) => s.capabilities);
  const theme = useSettingsStore((s) => s.theme);
  const [showSettings, setShowSettings] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumeCwd, setResumeCwd] = useState("");
  const [openPanel, setOpenPanel] = useState<"command" | "agent" | null>(null);

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
    !activeSessionId;

  return (
    <div className={`app theme-${theme}`}>
      <div className="status-bar">
        <div className={`status-dot ${connectionState}`} />
        <span>{getStatusLabel()}</span>
        <button className="status-settings-btn" onClick={() => setShowSettings(true)}>
          ⚙
        </button>
      </div>

      <SessionTabs />

      <ChatView
        messages={activeSession?.messages ?? []}
        isStreaming={activeSession?.isStreaming}
        activeToolStatus={activeSession?.activeToolStatus}
        activeTools={activeSession?.activeTools}
        activeAgents={activeSession?.activeAgents}
        activeHook={activeSession?.activeHook}
        cwd={activeSession?.cwd}
        onResumeSession={(cwd) => {
          setResumeCwd(cwd);
          setShowResumeModal(true);
        }}
      />

      <QuickActions
        capabilities={capabilities}
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

      <StatusBar />

      <InputBar
        onSend={(content) =>
          activeSessionId && wsService.send(activeSessionId, content)
        }
        disabled={isDisabled}
        capabilities={capabilities}
        onOpenCommandPanel={() => setOpenPanel("command")}
        onOpenAgentPanel={() => setOpenPanel("agent")}
      />

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {openPanel && (
        <PickerPanel
          mode={openPanel}
          capabilities={capabilities}
          disabled={isDisabled}
          onSelect={(value) => {
            useAppStore.getState().setInputDraft(value + " ");
            setOpenPanel(null);
          }}
          onClose={() => setOpenPanel(null)}
        />
      )}

      <SessionListModal
        isOpen={showResumeModal}
        dir={resumeCwd}
        onClose={() => setShowResumeModal(false)}
        onSelectSession={(sdkSessionId, cwd) => {
          wsService.resumeSession(sdkSessionId, cwd);
          setShowResumeModal(false);
        }}
      />
    </div>
  );
}
