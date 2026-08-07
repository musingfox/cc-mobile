import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { primePublicKey, resyncPushSubscription } from "./services/push-service";
import { loadSettings } from "./services/settings";
import { swRegistrationManager } from "./services/sw-registration";
import "./styles.css";
import "./design/animations.css";

// Linear Variant A fonts
import "@fontsource/fira-code/300.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register Service Worker for PWA support
window.addEventListener("load", async () => {
  // Prime push public key at startup (before any tap) so subscribe gesture has it cached.
  await primePublicKey();

  const registration = await swRegistrationManager.registerServiceWorker();

  // Re-tell server our current registration (recovery for lapsed tokens); only if user enabled.
  // Safe: skips if !enabled or !granted, never prompts, never throws.
  const settings = loadSettings();
  if (settings.notificationsEnabled) {
    resyncPushSubscription({ enabled: true }).catch(() => {});
  }

  if (registration) {
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          console.log("[sw-update] New version available");
        }
      });
    });
  }
});
