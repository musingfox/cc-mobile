import { describe, expect, it } from "bun:test";
import {
  isHookResponse,
  isHookStarted,
  isMemoryRecall,
  isTaskProgress,
} from "../services/tool-events";

describe("Tool Event Type Guards", () => {
  describe("isTaskProgress", () => {
    it("T4: valid task_progress → true", () => {
      const event = {
        type: "system",
        subtype: "task_progress",
        description: "Reading auth module",
        last_tool_name: "Read",
      };
      expect(isTaskProgress(event)).toBe(true);
    });

    it("should return true for task_progress without optional fields", () => {
      const event = {
        type: "system",
        subtype: "task_progress",
        description: "Processing",
      };
      expect(isTaskProgress(event)).toBe(true);
    });

    it("should return false for invalid event", () => {
      const event = {
        type: "system",
        subtype: "other",
        description: "test",
      };
      expect(isTaskProgress(event)).toBe(false);
    });
  });

  describe("isHookStarted", () => {
    it("returns true for valid hook_started event", () => {
      expect(
        isHookStarted({
          type: "system",
          subtype: "hook_started",
          hook_id: "h1",
          hook_name: "SessionStart:startup",
          hook_event: "SessionStart",
        }),
      ).toBe(true);
    });
    it("returns false for other system events", () => {
      expect(
        isHookStarted({
          type: "system",
          subtype: "task_started",
          task_id: "t1",
          description: "test",
        }),
      ).toBe(false);
    });
  });

  describe("isMemoryRecall", () => {
    it("returns true for valid memory_recall event", () => {
      expect(isMemoryRecall({ type: "system", subtype: "memory_recall" })).toBe(true);
    });
    it("returns false for other system subtypes", () => {
      expect(isMemoryRecall({ type: "system", subtype: "other" })).toBe(false);
    });
    it("returns false for non-system message types", () => {
      expect(isMemoryRecall({ type: "assistant" })).toBe(false);
    });
    it("returns false for null/undefined/non-object inputs", () => {
      expect(isMemoryRecall(null as unknown as Record<string, unknown>)).toBe(false);
      expect(isMemoryRecall(undefined as unknown as Record<string, unknown>)).toBe(false);
      expect(isMemoryRecall(42 as unknown as Record<string, unknown>)).toBe(false);
    });
  });

  describe("isHookResponse", () => {
    it("returns true for valid hook_response event", () => {
      expect(
        isHookResponse({
          type: "system",
          subtype: "hook_response",
          hook_id: "h1",
          hook_name: "SessionStart:startup",
          hook_event: "SessionStart",
        }),
      ).toBe(true);
    });
    it("returns false for non-hook events", () => {
      expect(
        isHookResponse({
          type: "system",
          subtype: "hook_started",
          hook_id: "h1",
          hook_name: "test",
          hook_event: "test",
        }),
      ).toBe(false);
    });
  });
});
