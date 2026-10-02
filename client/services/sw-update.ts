/**
 * sw-update.ts — puts a new service worker in front of the app while it stays
 * open.
 *
 * An installed iOS app is rarely closed, and a waiting worker only takes over
 * once no page uses the old one, so a deploy never reached the phone. The app
 * asks for an update check whenever it returns to the foreground, and
 * activates a waiting worker itself at a safe moment: right after a screen
 * change, with an empty composer. The draft survives the reload that follows
 * activation (it is saved per session as it is typed), but `controllerchange`
 * can land after the user has started typing, and a reload then would close
 * the keyboard on them mid-message. Not on `hidden`: on iOS the photo picker
 * and the camera hide the page, and a reload there loses the picked file.
 */

import { useAppStore } from "../stores/app-store";

export interface SwUpdaterDeps {
  isIdle(): boolean;
  reload(): void;
}

export function createSwUpdater({ isIdle, reload }: SwUpdaterDeps) {
  let registration: ServiceWorkerRegistration | null = null;
  let requested = false;
  let stale = false;

  return {
    track(
      reg: ServiceWorkerRegistration,
      container: ServiceWorkerContainer = navigator.serviceWorker,
      doc: Document = document,
    ) {
      registration = reg;
      let controlled = container.controller !== null;
      container.addEventListener("controllerchange", () => {
        // The first install claiming an uncontrolled page is not an update.
        if (!controlled) {
          controlled = true;
          return;
        }
        stale = true;
        // Another tab's activation lands here too; that one waits for our own
        // safe moment.
        if (requested && isIdle()) reload();
      });
      doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState === "visible") reg.update().catch(() => {});
      });
    },

    atSafeMoment() {
      if (!isIdle()) return;
      if (stale) {
        reload();
        return;
      }
      const waiting = registration?.waiting;
      if (!waiting) return;
      requested = true;
      waiting.postMessage({ type: "SKIP_WAITING" });
    },
  };
}

export const swUpdater = createSwUpdater({
  isIdle: () => useAppStore.getState().inputDraft.trim() === "",
  reload: () => window.location.reload(),
});
