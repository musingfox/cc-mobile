import { useCallback, useEffect } from "react";
import DebugOverlay from "./components/DebugOverlay";
import AppShell from "./components/linear/AppShell";
import ToastProvider from "./components/toasts/ToastProvider";
import { LifecycleManager } from "./services/lifecycle-manager";
import { wsService } from "./services/ws-service";
import { useAppStore } from "./stores/app-store";

export default function App() {
  const handleOnline = useCallback(() => {
    if (wsService.getReadyState() !== WebSocket.OPEN) wsService.connect();
  }, []);
  const handleOffline = useCallback(() => {
    /* connection banner is driven by store */
  }, []);

  useEffect(() => {
    // 1. Restore persisted sessions before connecting
    useAppStore.getState().restoreAllSessions();

    // 2. Connect to WebSocket
    wsService.connect();

    // 3. Setup lifecycle manager for persistence
    const lifecycleManager = new LifecycleManager({
      onBeforeHide: () => {
        useAppStore.getState().persistAllSessions();
      },
      onPageShow: () => {
        if (wsService.getReadyState() !== WebSocket.OPEN) wsService.connect();
      },
      onVisibilityRestore: () => {
        if (wsService.getReadyState() !== WebSocket.OPEN) wsService.connect();
      },
    });
    lifecycleManager.start();

    // 4. Online/offline listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      lifecycleManager.destroy();
      wsService.destroy();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  // Pin theme-color and body background to the Linear neutral canvas.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#0e0e10");
    document.body.style.backgroundColor = "#0e0e10";
  }, []);

  return (
    <ToastProvider theme="dark">
      <div className="app theme-linear">
        <AppShell />
        <DebugOverlay />
      </div>
    </ToastProvider>
  );
}
