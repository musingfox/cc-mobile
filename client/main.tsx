import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { swRegistrationManager } from "./services/sw-registration";
import "./styles.css";

// IBM Plex fonts for Ember theme
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register Service Worker for PWA support
window.addEventListener("load", async () => {
  const registration = await swRegistrationManager.registerServiceWorker();

  if (registration) {
    // Listen for updates
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // New service worker is waiting
          console.log("[sw-update] New version available");
          // For now, just log - UI toast will be added in a follow-up
          // Future: dispatch custom event or call toastService
        }
      });
    });
  }
});
