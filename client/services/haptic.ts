class HapticService {
  isSupported(): boolean {
    return typeof navigator !== "undefined" && "vibrate" in navigator;
  }

  vibrate(pattern: number | number[]): void {
    if (!this.isSupported()) {
      return;
    }

    navigator.vibrate(pattern);
  }
}

export const hapticService = new HapticService();
