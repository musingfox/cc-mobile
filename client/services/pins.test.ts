import { describe, test, expect, beforeEach } from "bun:test";
import { loadPins, savePins } from "./pins";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

global.localStorage = localStorageMock as any;

describe("PIN_SERVICE", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("T1: loadPins() with empty localStorage returns []", () => {
    const result = loadPins();
    expect(result).toEqual([]);
  });

  test("T2: loadPins() after savePins(['/help']) returns ['/help']", () => {
    savePins(["/help"]);
    const result = loadPins();
    expect(result).toEqual(["/help"]);
  });

  test("T3: loadPins() with corrupt localStorage returns []", () => {
    localStorage.setItem("claude-code-mobile-pinned-commands", "invalid json");
    const result = loadPins();
    expect(result).toEqual([]);
  });
});
