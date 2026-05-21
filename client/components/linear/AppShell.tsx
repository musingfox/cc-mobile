import { useState } from "react";
import { useAppStore } from "../../stores/app-store";
import AddProjectScreen from "./AddProjectScreen";
import ChatScreen from "./ChatScreen";
import ProjectDetailScreen from "./ProjectDetailScreen";
import ProjectsScreen from "./ProjectsScreen";
import SettingsScreen from "./SettingsScreen";
import "./shell.css";

export type LinearScreen = "projects" | "projectDetail" | "addProject" | "chat" | "settings";

function ConnectionBanner({ state }: { state: string }) {
  if (state !== "disconnected") return null;
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const msg = isOnline ? "Connection lost — reconnecting…" : "Offline — cached content";
  return <div className="lin-connection-banner">{msg}</div>;
}

export default function AppShell() {
  const connectionState = useAppStore((s) => s.connectionState);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  // Default: if we already have an active session, jump into Chat; else Projects home.
  const [screen, setScreen] = useState<LinearScreen>(activeSessionId ? "chat" : "projects");
  const [selectedProjectCwd, setSelectedProjectCwd] = useState<string | null>(null);

  const navigate = (next: LinearScreen) => setScreen(next);

  const openProject = (cwd: string) => {
    setSelectedProjectCwd(cwd);
    setScreen("projectDetail");
  };

  const handleProjectSaved = (cwd: string) => {
    setSelectedProjectCwd(cwd);
    setScreen("projectDetail");
  };

  return (
    <div className="lin-shell">
      <ConnectionBanner state={connectionState} />
      <div className="lin-shell-content">
        {screen === "projects" && (
          <ProjectsScreen
            onNavigate={navigate}
            onOpenProject={openProject}
            onAddProject={() => setScreen("addProject")}
          />
        )}
        {screen === "projectDetail" && selectedProjectCwd && (
          <ProjectDetailScreen
            cwd={selectedProjectCwd}
            onNavigate={navigate}
            onBack={() => setScreen("projects")}
          />
        )}
        {screen === "projectDetail" && !selectedProjectCwd && (
          <ProjectsScreen
            onNavigate={navigate}
            onOpenProject={openProject}
            onAddProject={() => setScreen("addProject")}
          />
        )}
        {screen === "addProject" && (
          <AddProjectScreen onSaved={handleProjectSaved} onCancel={() => setScreen("projects")} />
        )}
        {screen === "chat" && <ChatScreen onNavigate={navigate} />}
        {screen === "settings" && <SettingsScreen onNavigate={navigate} />}
      </div>
    </div>
  );
}
