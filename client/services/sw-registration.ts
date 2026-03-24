class SwRegistrationManager {
  private registration: ServiceWorkerRegistration | null = null;

  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      console.warn("[sw-registration] Service Worker not supported");
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      this.registration = registration;
      console.log("[sw-registration] registered:", registration.scope);
      return registration;
    } catch (error) {
      console.warn("[sw-registration] registration failed:", error);
      return null;
    }
  }

  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }
}

export const swRegistrationManager = new SwRegistrationManager();
