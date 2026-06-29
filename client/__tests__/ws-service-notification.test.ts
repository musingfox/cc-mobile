import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { handleNotificationChunk } from "../services/ws-service";

describe("handleNotificationChunk", () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    infoSpy = spyOn(toastService, "info").mockImplementation(() => "" as never);
    errorSpy = spyOn(toastService, "error").mockImplementation(() => "" as never);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("low priority → info with 2000ms timeout", () => {
    const seen = new Set<string>();
    const result = handleNotificationChunk(
      {
        type: "system",
        subtype: "notification",
        key: "k1",
        text: "Plugin reloaded",
        priority: "low",
      },
      seen,
    );

    expect(result).toBe(true);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith("Plugin reloaded", 2000);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("duplicate key suppressed: emits exactly once", () => {
    const seen = new Set<string>();
    const chunk = {
      type: "system",
      subtype: "notification",
      key: "k1",
      text: "Plugin reloaded",
      priority: "low",
    };

    handleNotificationChunk(chunk, seen);
    handleNotificationChunk(chunk, seen);

    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  test("immediate priority → error with 6000ms timeout", () => {
    const seen = new Set<string>();
    handleNotificationChunk(
      {
        type: "system",
        subtype: "notification",
        key: "k2",
        text: "Build failed",
        priority: "immediate",
      },
      seen,
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith("Build failed", 6000);
  });

  test("high priority → error with default 6000ms timeout", () => {
    const seen = new Set<string>();
    handleNotificationChunk(
      {
        type: "system",
        subtype: "notification",
        key: "k-high",
        text: "Disk low",
        priority: "high",
      },
      seen,
    );

    expect(errorSpy).toHaveBeenCalledWith("Disk low", 6000);
  });

  test("medium priority → info with 4000ms timeout", () => {
    const seen = new Set<string>();
    handleNotificationChunk(
      {
        type: "system",
        subtype: "notification",
        key: "k-med",
        text: "Settings saved",
        priority: "medium",
      },
      seen,
    );

    expect(infoSpy).toHaveBeenCalledWith("Settings saved", 4000);
  });

  test("unknown priority falls back to medium → info 4000ms", () => {
    const seen = new Set<string>();
    handleNotificationChunk(
      {
        type: "system",
        subtype: "notification",
        key: "k-unknown",
        text: "Hello",
        priority: "unknown",
      } as Record<string, unknown>,
      seen,
    );

    expect(infoSpy).toHaveBeenCalledWith("Hello", 4000);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("missing key → dedupe by text", () => {
    const seen = new Set<string>();
    const chunk = {
      type: "system",
      subtype: "notification",
      text: "Hello",
      priority: "low",
    };

    handleNotificationChunk(chunk, seen);
    handleNotificationChunk(chunk, seen);
    handleNotificationChunk(chunk, seen);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(seen.has("text:Hello")).toBe(true);
  });

  test("explicit timeout_ms overrides default", () => {
    const seen = new Set<string>();
    handleNotificationChunk(
      {
        type: "system",
        subtype: "notification",
        key: "kx",
        text: "Heads up",
        priority: "low",
        timeout_ms: 9000,
      },
      seen,
    );

    expect(infoSpy).toHaveBeenCalledWith("Heads up", 9000);
  });

  test("non-notification chunk: returns false, no side effects", () => {
    const seen = new Set<string>();
    const result = handleNotificationChunk(
      { type: "system", subtype: "api_retry" } as Record<string, unknown>,
      seen,
    );

    expect(result).toBe(false);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("two different keys: two toasts", () => {
    const seen = new Set<string>();
    handleNotificationChunk(
      { type: "system", subtype: "notification", key: "a", text: "first", priority: "low" },
      seen,
    );
    handleNotificationChunk(
      { type: "system", subtype: "notification", key: "b", text: "second", priority: "low" },
      seen,
    );

    expect(infoSpy).toHaveBeenCalledTimes(2);
  });
});
