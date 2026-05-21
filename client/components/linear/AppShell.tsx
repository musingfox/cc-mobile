import { useState } from "react";
import { useAppStore } from "../../stores/app-store";
import ChatScreen from "./ChatScreen";
import SessionsScreen from "./SessionsScreen";
import SettingsScreen from "./SettingsScreen";
import "./shell.css";

export type LinearScreen = "sessions" | "chat" | "settings";

function ConnectionBanner({ state }: { state: string }) {
  if (state === "connected") return null;
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const msg = isOnline ? "Connection lost — reconnecting…" : "Offline — cached content";
  return <div className="lin-connection-banner">{msg}</div>;
}

export default function AppShell() {
  const connectionState = useAppStore((s) => s.connectionState);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  // Default: if we already have an active session, jump into Chat; else Sessions list.
  const [screen, setScreen] = useState<LinearScreen>(activeSessionId ? "chat" : "sessions");

  const navigate = (next: LinearScreen) => setScreen(next);

  return (
    <div className="lin-shell">
      <ConnectionBanner state={connectionState} />
      <div className="lin-shell-content">
        {screen === "sessions" && <SessionsScreen onNavigate={navigate} />}
        {screen === "chat" && <ChatScreen onNavigate={navigate} />}
        {screen === "settings" && <SettingsScreen onNavigate={navigate} />}
      </div>
    </div>
  );
}
