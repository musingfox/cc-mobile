import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import AgentsScreen from "./AgentsScreen";
import BottomTabBar from "./BottomTabBar";
import ChatScreen from "./ChatScreen";
import CommandsScreen from "./CommandsScreen";
import ScreenHeader from "./ScreenHeader";
import SessionsScreen from "./SessionsScreen";
import SettingsScreen from "./SettingsScreen";

function EmberConnectionBanner({ connectionState }: { connectionState: string }) {
  if (connectionState === "connected") return null;

  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const message = isOnline
    ? "Connection lost — reconnecting..."
    : "You are offline — cached content available";

  return <div className="ember-connection-banner">{message}</div>;
}

function ScreenContent({ screenName }: { screenName: string }) {
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const setInputDraft = useAppStore((s) => s.setInputDraft);

  const handleAgentSelect = (agentName: string) => {
    setInputDraft(`@${agentName} `);
    setActiveScreen("chat");
  };

  const handleCommandSelect = (commandName: string) => {
    setInputDraft(`${commandName} `);
    setActiveScreen("chat");
  };

  switch (screenName) {
    case "sessions":
      return <SessionsScreen />;
    case "agents":
      return <AgentsScreen variant="screen" onSelect={handleAgentSelect} />;
    case "chat":
      return <ChatScreen />;
    case "commands":
      return <CommandsScreen variant="screen" onSelect={handleCommandSelect} />;
    case "settings":
      return <SettingsScreen />;
    default:
      return <ChatScreen />;
  }
}

function getScreenTitle(screenName: string): string {
  switch (screenName) {
    case "sessions":
      return "Sessions";
    case "agents":
      return "Agents";
    case "chat":
      return "Chat";
    case "commands":
      return "Commands";
    case "settings":
      return "Settings";
    default:
      return "Chat";
  }
}

export default function MobileShell() {
  const theme = useSettingsStore((s) => s.theme);
  const activeScreen = useAppStore((s) => s.activeScreen ?? "chat");
  const connectionState = useAppStore((s) => s.connectionState);

  // Only render when theme is ember
  if (theme !== "ember") return null;

  return (
    <div className="ember-shell">
      <EmberConnectionBanner connectionState={connectionState} />
      {activeScreen !== "chat" && activeScreen !== "sessions" && (
        <ScreenHeader title={getScreenTitle(activeScreen)} />
      )}
      <main className="ember-shell-content">
        <ScreenContent screenName={activeScreen} />
      </main>
      <BottomTabBar activeTab={activeScreen} onChange={useAppStore.getState().setActiveScreen} />
    </div>
  );
}
