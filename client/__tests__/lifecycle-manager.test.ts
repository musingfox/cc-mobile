import { beforeEach, describe, expect, mock, test } from "bun:test";
import { LifecycleManager } from "../services/lifecycle-manager";

describe("LifecycleManager", () => {
  let onBeforeHideMock: ReturnType<typeof mock>;
  let onPageShowMock: ReturnType<typeof mock>;
  let onVisibilityRestoreMock: ReturnType<typeof mock>;
  let manager: LifecycleManager;

  beforeEach(() => {
    onBeforeHideMock = mock(() => {});
    onPageShowMock = mock(() => {});
    onVisibilityRestoreMock = mock(() => {});
    manager = new LifecycleManager({
      onBeforeHide: onBeforeHideMock,
      onPageShow: onPageShowMock,
      onVisibilityRestore: onVisibilityRestoreMock,
    });
  });

  // TC-LC1: start() registers event listeners
  test("TC-LC1: start() registers event listeners", () => {
    const addEventListenerSpy = mock(() => {});
    const originalAddEventListener = document.addEventListener;
    const originalWindowAddEventListener = window.addEventListener;

    // Mock document.addEventListener
    document.addEventListener = addEventListenerSpy as typeof document.addEventListener;
    // Mock window.addEventListener
    window.addEventListener = addEventListenerSpy as typeof window.addEventListener;

    manager.start();

    // Should call addEventListener 3 times (visibilitychange, pagehide, pageshow)
    expect(addEventListenerSpy).toHaveBeenCalledTimes(3);

    // Restore
    document.addEventListener = originalAddEventListener;
    window.addEventListener = originalWindowAddEventListener;
  });

  // TC-LC2: visibilitychange (hidden=true) calls onBeforeHide
  test("TC-LC2: visibilitychange with hidden=true calls onBeforeHide", () => {
    manager.start();

    // Mock document.hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: true,
    });

    // Dispatch visibilitychange event
    const event = new Event("visibilitychange");
    document.dispatchEvent(event);

    expect(onBeforeHideMock).toHaveBeenCalledTimes(1);
    expect(onPageShowMock).toHaveBeenCalledTimes(0);

    manager.destroy();
  });

  // TC-LC3: pagehide event calls onBeforeHide
  test("TC-LC3: pagehide event calls onBeforeHide", () => {
    manager.start();

    const event = new Event("pagehide");
    window.dispatchEvent(event);

    expect(onBeforeHideMock).toHaveBeenCalledTimes(1);
    expect(onPageShowMock).toHaveBeenCalledTimes(0);

    manager.destroy();
  });

  // TC-LC4: pageshow event calls onPageShow
  test("TC-LC4: pageshow event calls onPageShow", () => {
    manager.start();

    const event = new Event("pageshow");
    window.dispatchEvent(event);

    expect(onBeforeHideMock).toHaveBeenCalledTimes(0);
    expect(onPageShowMock).toHaveBeenCalledTimes(1);

    manager.destroy();
  });

  // TC-LC5: destroy() removes all listeners
  test("TC-LC5: destroy() removes all listeners", () => {
    const removeEventListenerSpy = mock(() => {});
    const originalRemoveEventListener = document.removeEventListener;
    const originalWindowRemoveEventListener = window.removeEventListener;

    manager.start();

    // Mock removeEventListener
    document.removeEventListener = removeEventListenerSpy as typeof document.removeEventListener;
    window.removeEventListener = removeEventListenerSpy as typeof window.removeEventListener;

    manager.destroy();

    // Should call removeEventListener 3 times
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(3);

    // Restore
    document.removeEventListener = originalRemoveEventListener;
    window.removeEventListener = originalWindowRemoveEventListener;
  });

  // Additional: events after destroy should not trigger callbacks
  test("events after destroy should not trigger callbacks", () => {
    manager.start();
    manager.destroy();

    // Try to trigger events
    const visEvent = new Event("visibilitychange");
    document.dispatchEvent(visEvent);

    const pageHideEvent = new Event("pagehide");
    window.dispatchEvent(pageHideEvent);

    const pageShowEvent = new Event("pageshow");
    window.dispatchEvent(pageShowEvent);

    // Callbacks should not have been called since listeners were removed
    expect(onBeforeHideMock).toHaveBeenCalledTimes(0);
    expect(onPageShowMock).toHaveBeenCalledTimes(0);
  });

  // TC-LC6: visibilitychange with hidden=false calls onVisibilityRestore
  test("TC-LC6: visibilitychange with hidden=false calls onVisibilityRestore", () => {
    manager.start();

    // Mock document.hidden to false
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: false,
    });

    // Dispatch visibilitychange event
    const event = new Event("visibilitychange");
    document.dispatchEvent(event);

    expect(onVisibilityRestoreMock).toHaveBeenCalledTimes(1);
    expect(onBeforeHideMock).toHaveBeenCalledTimes(0);

    manager.destroy();
  });

  // TC-LC7: onVisibilityRestore is optional
  test("TC-LC7: onVisibilityRestore is optional", () => {
    const managerWithoutRestore = new LifecycleManager({
      onBeforeHide: onBeforeHideMock,
      onPageShow: onPageShowMock,
    });

    managerWithoutRestore.start();

    // Mock document.hidden to false
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: false,
    });

    // Dispatch visibilitychange event — should not throw
    const event = new Event("visibilitychange");
    expect(() => document.dispatchEvent(event)).not.toThrow();

    managerWithoutRestore.destroy();
  });
});
