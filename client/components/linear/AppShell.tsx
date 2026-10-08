import { useEffect, useRef, useState } from "react";
import { swUpdater } from "../../services/sw-update";
import { bindVisualViewport } from "../../services/visual-viewport";
import { useAppStore } from "../../stores/app-store";
import AddProjectScreen from "./AddProjectScreen";
import ChatScreen from "./ChatScreen";
import ProjectDetailScreen from "./ProjectDetailScreen";
import ProjectsScreen from "./ProjectsScreen";
import SettingsScreen from "./SettingsScreen";
import { planNavigation, ROOT, readStack, type ScreenEntry, seedStack } from "./screen-history";
import "./shell.css";

export type LinearScreen = "projects" | "projectDetail" | "addProject" | "chat" | "settings";

function ConnectionBanner({ state }: { state: string }) {
  if (state !== "disconnected") return null;
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  const msg = isOnline ? "Connection lost — reconnecting…" : "Offline — cached content";
  return <div className="lin-connection-banner">{msg}</div>;
}

function HerdrOfflineBanner() {
  const status = useAppStore((s) => s.herdrStatus);
  if (!status) return null;
  const cockpitDown = !status.cockpit.online;
  const hangarDown = status.hangar ? !status.hangar.online : false;
  if (!cockpitDown && !hangarDown) return null;
  const msg = !status.hangar
    ? "herdr offline"
    : cockpitDown && hangarDown
      ? "Cockpit and hangar offline"
      : cockpitDown
        ? "Cockpit offline"
        : "Hangar offline";
  return (
    <div className="lin-herdr-offline-banner" role="status">
      {msg}
    </div>
  );
}

export default function AppShell() {
  const connectionState = useAppStore((s) => s.connectionState);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  // A reload resumes the screen its history entry names; otherwise, with an
  // active session, jump into Chat; else Projects home.
  const [entry, setEntry] = useState<ScreenEntry>(
    () =>
      readStack(window.history.state)?.at(-1) ??
      (activeSessionId ? { screen: "chat", cwd: null } : ROOT),
  );
  const { screen, cwd: selectedProjectCwd } = entry;
  const initialEntry = useRef(entry);

  useEffect(() => {
    if (!readStack(window.history.state)) {
      const stack = seedStack(initialEntry.current);
      window.history.replaceState({ screens: stack.slice(0, 1) }, "");
      if (stack.length > 1) window.history.pushState({ screens: stack }, "");
    }
    const onPop = (event: PopStateEvent) => {
      setEntry(readStack(event.state)?.at(-1) ?? ROOT);
      swUpdater.atSafeMoment();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => bindVisualViewport(), []);

  const go = (target: ScreenEntry) => {
    const step = planNavigation(readStack(window.history.state) ?? [entry], target);
    if (step.kind === "go") {
      window.history.go(step.delta);
      return;
    }
    if (step.kind === "push") window.history.pushState({ screens: step.stack }, "");
    else window.history.replaceState({ screens: step.stack }, "");
    setEntry(step.stack[step.stack.length - 1]);
    swUpdater.atSafeMoment();
  };

  const navigate = (next: LinearScreen) => go({ screen: next, cwd: selectedProjectCwd });

  // The chat lost its session (a create the server refused, a pane that
  // ended): go back to where the user chose it rather than sit on a chat with
  // nothing behind it. Through `go`, so it is the same history step an in-app
  // Back takes. Read through a ref: `go` is rebuilt every render, and firing
  // again before the popstate lands would step back twice.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    if (screen === "chat" && activeSessionId === null) {
      goRef.current({ screen: "projectDetail", cwd: selectedProjectCwd });
    }
  }, [screen, activeSessionId, selectedProjectCwd]);

  const openProject = (cwd: string) => go({ screen: "projectDetail", cwd });

  return (
    <div className="lin-shell">
      <ConnectionBanner state={connectionState} />
      {connectionState !== "disconnected" && <HerdrOfflineBanner />}
      <div className="lin-shell-content">
        {screen === "projects" && (
          <ProjectsScreen
            onNavigate={navigate}
            onOpenProject={openProject}
            onAddProject={() => navigate("addProject")}
          />
        )}
        {screen === "projectDetail" && selectedProjectCwd && (
          <ProjectDetailScreen
            cwd={selectedProjectCwd}
            onNavigate={navigate}
            onBack={() => navigate("projects")}
          />
        )}
        {screen === "addProject" && (
          <AddProjectScreen onSaved={openProject} onCancel={() => navigate("projects")} />
        )}
        {screen === "chat" && <ChatScreen onNavigate={navigate} />}
        {screen === "settings" && <SettingsScreen onNavigate={navigate} />}
      </div>
    </div>
  );
}
