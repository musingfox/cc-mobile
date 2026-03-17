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

  showPermissionNotification(toolName: string): void {
    if (!this.isSupported()) {
      console.warn("[notification] not supported");
      return;
    }

    if (Notification.permission === "granted") {
      new Notification("CCMobile — Permission Required", {
        body: `Claude needs permission to run ${toolName}`,
      });
    } else {
      console.warn("[notification] permission not granted");
    }
  }
}

export const notificationService = new NotificationService();
