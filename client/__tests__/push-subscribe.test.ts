import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import SettingsScreen from "../components/linear/SettingsScreen";
import * as pushService from "../services/push-service";
import { swRegistrationManager } from "../services/sw-registration";
import { toastService } from "../services/toast-service";
import { useSettingsStore } from "../stores/settings-store";

const realFetch = globalThis.fetch;

describe("PushSubscribeGesture", () => {
  let errorSpy: ReturnType<typeof spyOn>;
  let getRegSpy: ReturnType<typeof mock>;
  let getKeySpy: ReturnType<typeof spyOn>;
  let uploadSpy: ReturnType<typeof spyOn>;

  let origNotification: any;
  let origPushManager: any;
  let origGetRegistration: any;
  let origRegistration: any;

  beforeEach(() => {
    useSettingsStore.setState({
      notificationsEnabled: false,
      hapticsEnabled: false,
      defaultCwd: "",
      theme: "dark",
    });
    (globalThis as any).__BASE_PATH__ = "";
    globalThis.fetch = realFetch;

    origNotification = (window as any).Notification;
    origPushManager = (window as any).PushManager;
    origGetRegistration = (swRegistrationManager as any).getRegistration.bind(
      swRegistrationManager,
    );
    origRegistration = (swRegistrationManager as any).registration;

    errorSpy = spyOn(toastService, "error").mockImplementation(() => "" as never);

    getKeySpy = spyOn(pushService, "getCachedPublicKey").mockReturnValue("BPk-public");

    uploadSpy = spyOn(pushService, "uploadSubscription").mockResolvedValue(undefined);

    // reset sw reg each time
    (swRegistrationManager as any).registration = null;
    getRegSpy = mock(() => null);
    (swRegistrationManager as any).getRegistration = getRegSpy;

    // ensure Notification + PushManager present so notifSupported + hasPushManager allow push path (happy-dom)
    if (typeof (window as any).Notification === "undefined") {
      (window as any).Notification = { permission: "default" };
    }
    if (typeof (window as any).PushManager === "undefined") {
      (window as any).PushManager = function PushManager() {} as any;
    }
  });

  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
    getKeySpy.mockRestore();
    uploadSpy.mockRestore();
    (window as any).Notification = origNotification;
    (window as any).PushManager = origPushManager;
    (swRegistrationManager as any).getRegistration = origGetRegistration;
    (swRegistrationManager as any).registration = null;
    globalThis.fetch = realFetch;
  });

  function getNotificationsToggle(container: HTMLElement) {
    const title = Array.from(container.querySelectorAll(".lin-settings-row-title")).find(
      (el) => el.textContent === "Notifications",
    );
    const row = title?.closest(".lin-settings-row");
    return row?.querySelector("button.lin-toggle") as HTMLButtonElement | null;
  }

  function getNotificationsDesc(container: HTMLElement) {
    const title = Array.from(container.querySelectorAll(".lin-settings-row-title")).find(
      (el) => el.textContent === "Notifications",
    );
    const row = title?.closest(".lin-settings-row");
    return row?.querySelector(".lin-settings-row-desc")?.textContent;
  }

  test("T1: given fireEvent.click on the toggle (off -> on) with a fake registration whose pushManager.subscribe returns a never-resolving promise -> expect subscribe called in SAME synchronous turn as click", () => {
    const fakeSubscribe = mock(() => new Promise(() => {})); // never resolves
    const fakeReg = {
      pushManager: { subscribe: fakeSubscribe },
    } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue("BPk");

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container);
    expect(toggle).not.toBeNull();

    fireEvent.click(toggle!);

    // MUST be called in same sync turn -- no await/tick/act between this click and assert
    expect(fakeSubscribe).toHaveBeenCalled();
  });

  test("T2: given the same click while subscribe promise still unresolved -> expect toggle disabled, row desc Enabling…, notificationsEnabled still false", () => {
    const fakeSubscribe = mock(() => new Promise(() => {}));
    const fakeReg = { pushManager: { subscribe: fakeSubscribe } } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue("BPk");

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    fireEvent.click(toggle);

    // allow one microtask for react update from setState inside handler
    // (T1 assert happened before this)
    return Promise.resolve().then(() => {
      const afterToggle = getNotificationsToggle(container)!;
      expect(afterToggle.disabled).toBe(true);
      expect(getNotificationsDesc(container)).toBe("Enabling…");
      expect(useSettingsStore.getState().notificationsEnabled).toBe(false);
    });
  });

  test("T3: given subscribe rejecting DOMException with name NotAllowedError -> expect toast error permission not granted; enabled still false", async () => {
    const notAllowed = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const fakeSubscribe = mock(() => Promise.reject(notAllowed));
    const fakeReg = { pushManager: { subscribe: fakeSubscribe } } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue("BPk");

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    fireEvent.click(toggle);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith("Notification permission was not granted");
    expect(useSettingsStore.getState().notificationsEnabled).toBe(false);
  });

  test("T4: given click when swRegistrationManager.getRegistration() is null -> expect toast sw not ready; subscribe never called", () => {
    getRegSpy.mockReturnValue(null);
    getKeySpy.mockReturnValue("BPk");

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    fireEvent.click(toggle);

    expect(errorSpy).toHaveBeenCalledWith("Service worker not ready — reload and try again");
    // no subscribe happened because reg null before
  });

  test("T5: given click when the cached public key is null -> expect toast Push not configured", () => {
    const fakeReg = { pushManager: { subscribe: mock() } } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue(null);

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    fireEvent.click(toggle);

    expect(errorSpy).toHaveBeenCalledWith("Push is not configured on the server");
  });

  test("T6: given click when window.PushManager undefined but Notification exists and resolves granted -> expect requestPermission path and enabled true", async () => {
    // setup reg but no pushManager capability
    const fakeReg = { pushManager: undefined } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue("whatever"); // not used

    // simulate no PushManager, but Notification present
    const origPush = (window as any).PushManager;
    const origNotif = (window as any).Notification;
    delete (window as any).PushManager;
    (window as any).Notification = {
      permission: "default",
      requestPermission: mock(() => Promise.resolve("granted")),
    };

    // also need to make notificationService use it, but since we don't touch notif, and handle falls to request
    // but SettingsScreen calls notificationService only in the !hasPush branch
    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    fireEvent.click(toggle);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useSettingsStore.getState().notificationsEnabled).toBe(true);

    // restore
    (window as any).PushManager = origPush;
    (window as any).Notification = origNotif;
  });

  test("T7: given click on the toggle (on -> off) -> expect notificationsEnabled false with no subscribe call", () => {
    // start enabled
    useSettingsStore.setState({ notificationsEnabled: true });
    const fakeSubscribe = mock(() => Promise.resolve({ toJSON: () => ({}) }));
    const fakeReg = { pushManager: { subscribe: fakeSubscribe } } as any;
    getRegSpy.mockReturnValue(fakeReg);

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    // currently on=true
    fireEvent.click(toggle);

    expect(useSettingsStore.getState().notificationsEnabled).toBe(false);
    expect(fakeSubscribe).not.toHaveBeenCalled();
  });

  test("T8: given subscribe resolving and upload resolving -> expect enabled true, desc normal, no success toast", async () => {
    const fakeSub = { toJSON: () => ({ endpoint: "e", keys: { p256dh: "p", auth: "a" } }) };
    const subP = Promise.resolve(fakeSub);
    const fakeSubscribe = mock(() => subP);
    const fakeReg = { pushManager: { subscribe: fakeSubscribe } } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue("BPk");

    const { promise: uploadP, resolve: resolveUpload } = Promise.withResolvers<void>();
    uploadSpy.mockReturnValue(uploadP);

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    await act(async () => {
      fireEvent.click(toggle);
      await subP;
      resolveUpload();
      await uploadP;
    });

    expect(useSettingsStore.getState().notificationsEnabled).toBe(true);
    expect(getNotificationsDesc(container)).toBe("Permission requests & completion");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("T9: given subscribe resolving but upload rejecting -> expect toast Could not register; enabled still false", async () => {
    const fakeSub = { toJSON: () => ({}) };
    const fakeSubscribe = mock(() => Promise.resolve(fakeSub));
    const fakeReg = { pushManager: { subscribe: fakeSubscribe } } as any;
    getRegSpy.mockReturnValue(fakeReg);
    getKeySpy.mockReturnValue("BPk");
    uploadSpy.mockRejectedValue(new Error("boom"));

    const { container } = render(React.createElement(SettingsScreen, { onNavigate: () => {} }));
    const toggle = getNotificationsToggle(container)!;

    fireEvent.click(toggle);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith("Could not register this device for push");
    expect(useSettingsStore.getState().notificationsEnabled).toBe(false);
  });
});
