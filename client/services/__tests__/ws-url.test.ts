import { describe, expect, spyOn, test } from "bun:test";
import { createSettingsStore } from "../../stores/settings-store";
import { buildWsUrl } from "../ws-service";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("Contract 6: Client WS URL", () => {
  test("empty basePath + localhost:5173 → ws://localhost:5173/ws", () => {
    expect(buildWsUrl("ws:", "localhost:5173", "", "")).toBe("ws://localhost:5173/ws");
  });

  test('"/cc" + example.com (HTTPS) → wss://example.com/cc/ws', () => {
    expect(buildWsUrl("wss:", "example.com", "/cc", "")).toBe("wss://example.com/cc/ws");
  });

  test("uses the persisted store device name and omits it after clearing", () => {
    const store = createSettingsStore(new MemoryStorage());
    store.getState().setDeviceName("書房 Mac");
    expect(buildWsUrl("wss:", "example.com", "", store.getState().deviceName)).toBe(
      "wss://example.com/ws?device=%E6%9B%B8%E6%88%BF%20Mac",
    );

    store.getState().setDeviceName("");
    expect(buildWsUrl("wss:", "example.com", "", store.getState().deviceName)).not.toContain(
      "device=",
    );
  });
});

describe("ClientIdentityCapture — device defaults", () => {
  test("generates, persists, and reloads one device name without randomUUID", () => {
    const storage = new MemoryStorage();
    const randomUuid = spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("randomUUID unavailable");
    });
    try {
      const first = createSettingsStore(storage).getState().deviceName;
      const second = createSettingsStore(storage).getState().deviceName;
      expect(first).toMatch(/^device-[0-9a-f]{4}$/);
      expect(second).toBe(first);
      expect(randomUuid).not.toHaveBeenCalled();
    } finally {
      randomUuid.mockRestore();
    }
  });

  test("independent first-time stores receive distinct defaults", () => {
    const first = createSettingsStore(new MemoryStorage()).getState().deviceName;
    const second = createSettingsStore(new MemoryStorage()).getState().deviceName;
    expect(first).not.toBe(second);
  });
});
