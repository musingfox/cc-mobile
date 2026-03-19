import { useSettingsStore } from "../stores/settings-store";

class HapticService {
  isSupported(): boolean {
    return typeof navigator !== "undefined" && "vibrate" in navigator;
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.isSupported()) return;
    if (!useSettingsStore.getState().hapticsEnabled) return;
    navigator.vibrate(pattern);
  }

  /** Light tap — message sent, action confirmed */
  tap(): void {
    this.vibrate(15);
  }

  /** Medium press — permission approved */
  confirm(): void {
    this.vibrate(50);
  }

  /** Double pulse — permission denied, warning */
  warn(): void {
    this.vibrate([30, 20, 30]);
  }

  /** Short buzz — stream/task completed */
  complete(): void {
    this.vibrate([10, 30, 10]);
  }

  /** Heavy single — error */
  error(): void {
    this.vibrate(100);
  }
}

export const hapticService = new HapticService();
