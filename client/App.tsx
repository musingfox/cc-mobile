import { ChevronRight, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import ChatView from "./components/ChatView";
import DebugOverlay from "./components/DebugOverlay";
import InputBar from "./components/InputBar";
import ModelPicker from "./components/ModelPicker";
import PermissionBar from "./components/PermissionBar";
import PickerPanel from "./components/PickerPanel";
import QuickActions from "./components/QuickActions";
import SessionListModal from "./components/SessionListModal";
import SessionTabs from "./components/SessionTabs";
import Settings from "./components/Settings";
import ToastProvider from "./components/toasts/ToastProvider";
import { wsService } from "./services/ws-service";
import type { Capabilities, RateLimitInfo } from "./stores/app-store";
import { useAppStore } from "./stores/app-store";
import { useSettingsStore } from "./stores/settings-store";

function formatResetTime(resetsAt: number): string {
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return "soon";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours > 0 ? `${hours}h${mins % 60}m` : `${mins}m`;
}

function StatusInfoBar({
  capabilities,
  rateLimitInfo,
  onModelClick,
}: {
  capabilities: Capabilities | null;
  rateLimitInfo: RateLimitInfo | null;
  onModelClick: () => void;
}) {
  const account = capabilities?.accountInfo;
  const model = capabilities?.model;
  const showRateLimit = rateLimitInfo && rateLimitInfo.status !== "allowed";

  if (!account && !model && !showRateLimit) return null;

  // Build info segments
  const segments: string[] = [];
  if (model) segments.push(model);
  if (account?.subscriptionType) segments.push(account.subscriptionType);
  if (account?.email) segments.push(account.email);
  if (account?.organization) segments.push(account.organization);

  if (segments.length === 0 && !showRateLimit) return null;

  return (
    <button type="button" className="status-info-bar" onClick={onModelClick}>
      <ChevronRight size={12} className="status-info-chevron" />
      {segments.length > 0 && <span className="status-info-segments">{segments.join(" · ")}</span>}
      {showRateLimit && (
        <span
          className={`rate-limit-badge ${rateLimitInfo.status === "rejected" ? "rate-limit-rejected" : "rate-limit-warning"}`}
        >
          {rateLimitInfo.status === "rejected"
            ? `Rate limited${rateLimitInfo.resetsAt ? ` · resets ${formatResetTime(rateLimitInfo.resetsAt)}` : ""}`
            : rateLimitInfo.utilization !== undefined
              ? `${Math.round(rateLimitInfo.utilization * 100)}% used`
              : "Near limit"}
        </span>
      )}
    </button>
  );
}

export default function App() {
  const connectionState = useAppStore((s) => s.connectionState);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const capabilities = useAppStore((s) => s.capabilities);
  const rateLimitInfo = useAppStore((s) => s.rateLimitInfo);
  const theme = useSettingsStore((s) => s.theme);
  const [showSettings, setShowSettings] = useState(false);
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [resumeCwd, setResumeCwd] = useState("");
  const [openPanel, setOpenPanel] = useState<"command" | "agent" | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : undefined;

  const handleOnline = useCallback(() => setIsOnline(true), []);
  const handleOffline = useCallback(() => setIsOnline(false), []);

  useEffect(() => {
    wsService.connect();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      wsService.destroy();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

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
        return `Connected${activeSession ? ` — ${activeSession.cwd.split("/").pop()}` : ""}`;
      case "disconnected":
        return "Disconnected";
    }
  };

  const formatUsage = () => {
    const usage = activeSession?.usage;
    if (!usage) return null;
    const tokens = usage.inputTokens + usage.outputTokens;
    const t =
      tokens >= 1_000_000
        ? `${(tokens / 1_000_000).toFixed(1)}M`
        : tokens >= 1_000
          ? `${(tokens / 1_000).toFixed(1)}k`
          : String(tokens);
    return `$${usage.totalCost.toFixed(2)} · ${t} · ${usage.turns}t`;
  };

  const isDisabled = connectionState !== "connected" || !activeSessionId;

  return (
    <div className={`app theme-${theme}`}>
      <ToastProvider theme={theme} />

      <div className="status-bar">
        <div className="status-bar-row">
          <div className={`status-dot ${connectionState}`} />
          <span className="status-label">{getStatusLabel()}</span>
          {formatUsage() && <span className="status-usage">{formatUsage()}</span>}
          <button
            type="button"
            className="status-settings-btn"
            onClick={() => setShowSettings(true)}
          >
            <SettingsIcon size={20} />
          </button>
        </div>
        <StatusInfoBar
          capabilities={capabilities}
          rateLimitInfo={rateLimitInfo}
          onModelClick={() => setShowModelPicker(true)}
        />
      </div>

      {connectionState === "disconnected" && (
        <div className="offline-banner">
          {isOnline
            ? "Connection lost — reconnecting..."
            : "You are offline — cached content available"}
        </div>
      )}

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
        activeSessionId={activeSessionId}
      />

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showModelPicker && <ModelPicker onClose={() => setShowModelPicker(false)} />}

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

      <DebugOverlay />
    </div>
  );
}
