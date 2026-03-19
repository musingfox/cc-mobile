class NotificationService {
  isSupported(): boolean {
    return typeof window !== "undefined" && "Notification" in window;
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) {
      return "denied";
    }

    try {
      return await Notification.requestPermission();
    } catch (error) {
      console.warn("[notification] permission request failed:", error);
      return "denied";
    }
  }

  showPermissionNotification(toolName: string, sessionId?: string): void {
    if (!this.isSupported()) {
      console.warn("[notification] not supported");
      return;
    }

    if (Notification.permission !== "granted") {
      console.warn("[notification] permission not granted");
      return;
    }

    // Use tag to deduplicate — only latest notification per session is shown
    const tag = sessionId ? `cc-mobile-permission-${sessionId}` : "cc-mobile-permission";

    new Notification("CCMobile — Permission Required", {
      body: `Claude needs permission to run ${toolName}`,
      tag,
      renotify: true,
    });
  }
}

export const notificationService = new NotificationService();
