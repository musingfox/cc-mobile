import { beforeEach, describe, expect, mock, test } from "bun:test";
import { hapticService } from "../services/haptic";
import { notificationService } from "../services/notification";
import { loadSettings, saveSettings } from "../services/settings";
import { voiceInputService } from "../services/voice-input";

// TC1-TC4: NotificationService
describe("NotificationService", () => {
  beforeEach(() => {
    delete (globalThis as any).Notification;
  });

  test("TC1: isSupported returns true when Notification exists", () => {
    (globalThis as any).Notification = {
      permission: "default",
      requestPermission: () => Promise.resolve("granted"),
    };
    expect(notificationService.isSupported()).toBe(true);
  });

  test("TC2: isSupported returns false when Notification undefined", () => {
    delete (globalThis as any).Notification;
    expect(notificationService.isSupported()).toBe(false);
  });

  test("TC3: requestPermission returns granted on success", async () => {
    (globalThis as any).Notification = {
      permission: "default",
      requestPermission: () => Promise.resolve("granted"),
    };
    const result = await notificationService.requestPermission();
    expect(result).toBe("granted");
  });

  test("TC4: requestPermission returns denied when unsupported", async () => {
    delete (globalThis as any).Notification;
    const result = await notificationService.requestPermission();
    expect(result).toBe("denied");
  });
});

// TC5-TC8: VoiceInputService
describe("VoiceInputService", () => {
  beforeEach(() => {
    delete (globalThis as any).SpeechRecognition;
    delete (globalThis as any).webkitSpeechRecognition;
  });

  test("TC5: isSupported returns true when SpeechRecognition exists", () => {
    (globalThis as any).SpeechRecognition = class {};
    expect(voiceInputService.isSupported()).toBe(true);
  });

  test("TC6: isSupported returns false when neither API exists", () => {
    delete (globalThis as any).SpeechRecognition;
    delete (globalThis as any).webkitSpeechRecognition;
    expect(voiceInputService.isSupported()).toBe(false);
  });

  test("TC7: isSupported returns true when webkitSpeechRecognition exists", () => {
    (globalThis as any).webkitSpeechRecognition = class {};
    expect(voiceInputService.isSupported()).toBe(true);
  });

  test("TC8: startListening calls onError when unsupported", () => {
    delete (globalThis as any).SpeechRecognition;
    delete (globalThis as any).webkitSpeechRecognition;
    const onResult = mock(() => {});
    const onError = mock(() => {});
    voiceInputService.startListening(onResult, onError);
    expect(onError).toHaveBeenCalledWith("Speech recognition not supported");
    expect(onResult).not.toHaveBeenCalled();
  });
});

// TC9-TC12: HapticService
describe("HapticService", () => {
  beforeEach(() => {
    delete (navigator as any).vibrate;
  });

  test("TC9: isSupported returns true when vibrate exists", () => {
    (navigator as any).vibrate = () => true;
    expect(hapticService.isSupported()).toBe(true);
  });

  test("TC10: isSupported returns false when vibrate undefined", () => {
    delete (navigator as any).vibrate;
    expect(hapticService.isSupported()).toBe(false);
  });

  test("TC11: semantic methods call navigator.vibrate when enabled", () => {
    const mockVibrate = mock(() => true);
    (navigator as any).vibrate = mockVibrate;
    // Enable haptics in settings store
    const { useSettingsStore } = require("../stores/settings-store");
    useSettingsStore.getState().setHapticsEnabled(true);
    hapticService.tap();
    expect(mockVibrate).toHaveBeenCalledWith(15);
    hapticService.confirm();
    expect(mockVibrate).toHaveBeenCalledWith(50);
    hapticService.warn();
    expect(mockVibrate).toHaveBeenCalledWith([30, 20, 30]);
    useSettingsStore.getState().setHapticsEnabled(false);
  });

  test("TC12: semantic methods no-op when unsupported", () => {
    delete (navigator as any).vibrate;
    expect(() => hapticService.tap()).not.toThrow();
    expect(() => hapticService.error()).not.toThrow();
  });
});

// TC13-TC15: Settings schema
describe("Settings schema", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("TC13: loadSettings defaults new fields to false", () => {
    const s = loadSettings();
    expect(s.notificationsEnabled).toBe(false);
    expect(s.voiceInputEnabled).toBe(false);
    expect(s.hapticsEnabled).toBe(false);
  });

  test("TC14: saveSettings persists new fields", () => {
    saveSettings({
      defaultCwd: "/tmp",
      theme: "light",
      notificationsEnabled: true,
      voiceInputEnabled: true,
      hapticsEnabled: true,
    });
    const s = loadSettings();
    expect(s.notificationsEnabled).toBe(true);
    expect(s.voiceInputEnabled).toBe(true);
    expect(s.hapticsEnabled).toBe(true);
  });

  test("TC15: loadSettings backward compat with old data", () => {
    localStorage.setItem(
      "cc-mobile-settings",
      JSON.stringify({ defaultCwd: "/foo", theme: "dark" }),
    );
    const s = loadSettings();
    expect(s.defaultCwd).toBe("/foo");
    expect(s.notificationsEnabled).toBe(false);
    expect(s.voiceInputEnabled).toBe(false);
    expect(s.hapticsEnabled).toBe(false);
  });
});
