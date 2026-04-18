import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import BottomTabBar from "./BottomTabBar";
import ScreenHeader from "./ScreenHeader";

function EmberConnectionBanner({ connectionState }: { connectionState: string }) {
  if (connectionState === "connected") return null;

  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const message = isOnline
    ? "Connection lost — reconnecting..."
    : "You are offline — cached content available";

  return <div className="ember-connection-banner">{message}</div>;
}

function ScreenContent({ screenName }: { screenName: string }) {
  // Placeholder content for each screen
  // T5-T9 will replace these with actual implementations
  switch (screenName) {
    case "sessions":
      return <div className="ember-screen-placeholder">Sessions (T6)</div>;
    case "agents":
      return <div className="ember-screen-placeholder">Agents (T7)</div>;
    case "chat":
      return <div className="ember-screen-placeholder">Chat (T5)</div>;
    case "commands":
      return <div className="ember-screen-placeholder">Commands (T8)</div>;
    case "settings":
      return <div className="ember-screen-placeholder">Settings (T9)</div>;
    default:
      return <div className="ember-screen-placeholder">Chat (T5)</div>;
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
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const connectionState = useAppStore((s) => s.connectionState);

  // Only render when theme is ember
  if (theme !== "ember") return null;

  const screenTitle = getScreenTitle(activeScreen);

  return (
    <div className="ember-shell">
      <EmberConnectionBanner connectionState={connectionState} />
      <ScreenHeader title={screenTitle} />
      <main className="ember-shell-content">
        <ScreenContent screenName={activeScreen} />
      </main>
      <BottomTabBar activeTab={activeScreen} onChange={setActiveScreen} />
    </div>
  );
}
