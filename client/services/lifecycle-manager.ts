export class LifecycleManager {
  private callbacks: {
    onBeforeHide: () => void;
    onPageShow: () => void;
    onVisibilityRestore?: () => void;
  };

  private visibilityChangeHandler: () => void;
  private pageHideHandler: () => void;
  private pageShowHandler: () => void;

  constructor(callbacks: {
    onBeforeHide: () => void;
    onPageShow: () => void;
    onVisibilityRestore?: () => void;
  }) {
    this.callbacks = callbacks;

    // Bind handlers
    this.visibilityChangeHandler = () => {
      if (document.hidden) {
        this.callbacks.onBeforeHide();
      } else if (this.callbacks.onVisibilityRestore) {
        this.callbacks.onVisibilityRestore();
      }
    };

    this.pageHideHandler = () => {
      this.callbacks.onBeforeHide();
    };

    this.pageShowHandler = () => {
      this.callbacks.onPageShow();
    };
  }

  start(): void {
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);
    window.addEventListener("pagehide", this.pageHideHandler);
    window.addEventListener("pageshow", this.pageShowHandler);
  }

  destroy(): void {
    document.removeEventListener("visibilitychange", this.visibilityChangeHandler);
    window.removeEventListener("pagehide", this.pageHideHandler);
    window.removeEventListener("pageshow", this.pageShowHandler);
  }
}
