import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toastService } from "../services/toast-service";
import { handleModelNotFoundError } from "../services/ws-service";
import { useSettingsStore } from "../stores/settings-store";

describe("handleModelNotFoundError", () => {
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    useSettingsStore.setState({ model: "claude-sonnet-4-6" });
    errorSpy = spyOn(toastService, "error").mockImplementation(() => "" as never);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    useSettingsStore.setState({ model: "" });
  });

  test("assistant chunk with model_not_found and active model: fires toast, resets model, returns true", () => {
    const result = handleModelNotFoundError({
      type: "assistant",
      error: "model_not_found",
    });

    expect(result).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Model claude-sonnet-4-6 unavailable, falling back to device default",
    );
    expect(useSettingsStore.getState().model).toBe("");
  });

  test("second invocation when model is already empty: returns false, no side effects", () => {
    const first = handleModelNotFoundError({
      type: "assistant",
      error: "model_not_found",
    });
    expect(first).toBe(true);

    errorSpy.mockClear();
    const beforeModel = useSettingsStore.getState().model;

    const second = handleModelNotFoundError({
      type: "assistant",
      error: "model_not_found",
    });

    expect(second).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().model).toBe(beforeModel);
  });

  test("model already empty (idempotency): returns false, no toast, no setModel call", () => {
    useSettingsStore.setState({ model: "" });
    errorSpy.mockClear();
    const setModelSpy = spyOn(useSettingsStore.getState(), "setModel");

    try {
      const result = handleModelNotFoundError({
        type: "assistant",
        error: "model_not_found",
      });

      expect(result).toBe(false);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(setModelSpy).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().model).toBe("");
    } finally {
      setModelSpy.mockRestore();
    }
  });

  test("assistant chunk with different error code: returns false, no side effects", () => {
    const result = handleModelNotFoundError({
      type: "assistant",
      error: "some_other_error",
    });

    expect(result).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().model).toBe("claude-sonnet-4-6");
  });

  test("assistant chunk with no error field: returns false, no side effects", () => {
    const result = handleModelNotFoundError({
      type: "assistant",
    });

    expect(result).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().model).toBe("claude-sonnet-4-6");
  });

  test("non-assistant chunk type with model_not_found error: returns false, no side effects", () => {
    const result = handleModelNotFoundError({
      type: "result",
      error: "model_not_found",
    });

    expect(result).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().model).toBe("claude-sonnet-4-6");
  });
});
