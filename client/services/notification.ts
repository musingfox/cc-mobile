import { swRegistrationManager } from "./sw-registration";

class NotificationService {
  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      "Notification" in window &&
      swRegistrationManager.getRegistration() !== null
    );
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "denied";
    }

    try {
      return await Notification.requestPermission();
    } catch (error) {
      console.warn("[notification] permission request failed:", error);
      return "denied";
    }
  }

  private async show(title: string, body: string, tag: string): Promise<void> {
    const registration = swRegistrationManager.getRegistration();

    if (!registration) {
      console.warn("[notification] no service worker registration available");
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      console.warn("[notification] not supported");
      return;
    }

    if (Notification.permission !== "granted") {
      console.warn("[notification] permission not granted");
      return;
    }

    try {
      await registration.showNotification(title, { body, tag, renotify: true });
    } catch (error) {
      console.error("[notification] showNotification failed:", error);
    }
  }

  async showPermissionNotification(
    toolName: string,
    sessionId?: string,
    cwd?: string,
  ): Promise<void> {
    const tag = sessionId ? `cc-mobile-permission-${sessionId}` : "cc-mobile-permission";
    const project = cwd ? cwd.split("/").pop() || cwd : null;
    const body = project
      ? `${project}: permission needed for ${toolName}`
      : `Permission needed for ${toolName}`;
    await this.show("CCMobile", body, tag);
  }

  async showResponseComplete(sessionId?: string, cwd?: string): Promise<void> {
    const tag = sessionId ? `cc-mobile-done-${sessionId}` : "cc-mobile-done";
    const project = cwd ? cwd.split("/").pop() || cwd : null;
    const body = project ? `${project}: response complete` : "Response complete";
    await this.show("CCMobile", body, tag);
  }
}

export const notificationService = new NotificationService();
