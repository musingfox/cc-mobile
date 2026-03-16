import { useEffect, useState } from "react";
import ChatView from "./components/ChatView";
import InputBar from "./components/InputBar";
import PermissionBar from "./components/PermissionBar";
import PickerPanel from "./components/PickerPanel";
import QuickActions from "./components/QuickActions";
import SessionListModal from "./components/SessionListModal";
import SessionTabs from "./components/SessionTabs";
import Settings from "./components/Settings";
import { wsService } from "./services/ws-service";
import { useAppStore } from "./stores/app-store";
import { useSettingsStore } from "./stores/settings-store";

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

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : undefined;

  useEffect(() => {
    wsService.connect();
    return () => wsService.destroy();
  }, []);

  // Update theme-color meta tag dynamically
  useEffect(() => {
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const themeColors = {
        dark: "#0066ff",
        light: "#0066ff",
        claude: "#da7756",
      };
      metaThemeColor.setAttribute("content", themeColors[theme]);
    }
  }, [theme]);

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

  const isDisabled = connectionState !== "connected" || !activeSessionId;

  return (
    <div className={`app theme-${theme}`}>
      <div className="status-bar">
        <div className={`status-dot ${connectionState}`} />
        <span>{getStatusLabel()}</span>
        <button type="button" className="status-settings-btn" onClick={() => setShowSettings(true)}>
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

      <QuickActions capabilities={capabilities} disabled={isDisabled} />

      <PermissionBar
        pending={activeSession?.pendingPermission ?? null}
        onApprove={() => activeSessionId && wsService.approvePermission(activeSessionId)}
        onDeny={() => activeSessionId && wsService.denyPermission(activeSessionId)}
      />

      <InputBar
        onSend={(content) => activeSessionId && wsService.send(activeSessionId, content)}
        disabled={isDisabled}
        capabilities={capabilities}
        onOpenCommandPanel={() => setOpenPanel("command")}
        onOpenAgentPanel={() => setOpenPanel("agent")}
        connected={connectionState === "connected"}
        usage={activeSession?.usage ?? null}
        activeSessionId={activeSessionId}
      />

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {openPanel && (
        <PickerPanel
          mode={openPanel}
          capabilities={capabilities}
          disabled={isDisabled}
          onSelect={(value) => {
            useAppStore.getState().setInputDraft(`${value} `);
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
