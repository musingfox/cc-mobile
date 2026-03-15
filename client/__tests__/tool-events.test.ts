import { describe, it, expect } from "bun:test";
import { isToolProgress, isToolUseSummary, isTaskProgress, isHookStarted, isHookResponse } from "../services/tool-events";

describe("Tool Event Type Guards", () => {
  describe("isToolProgress", () => {
    it("T1: valid tool_progress → true", () => {
      const event = {
        type: "tool_progress",
        tool_use_id: "t123",
        tool_name: "Read",
        parent_tool_use_id: null,
        elapsed_time_seconds: 1.5,
      };
      expect(isToolProgress(event)).toBe(true);
    });

    it("T2: invalid event → false (wrong type)", () => {
      const event = { type: "system" };
      expect(isToolProgress(event)).toBe(false);
    });

    it("T2: invalid event → false (missing required fields)", () => {
      const event = { type: "tool_progress" };
      expect(isToolProgress(event)).toBe(false);
    });

    it("should match with only type and tool_name (minimal fields)", () => {
      const event = {
        type: "tool_progress",
        tool_name: "Read",
      };
      expect(isToolProgress(event)).toBe(true);
    });
  });

  describe("isToolUseSummary", () => {
    it("T3: valid tool_use_summary → true", () => {
      const event = {
        type: "tool_use_summary",
        summary: "Read file auth.ts",
        preceding_tool_use_ids: ["t123"],
      };
      expect(isToolUseSummary(event)).toBe(true);
    });

    it("should return false for invalid event", () => {
      const event = { type: "tool_use_summary" };
      expect(isToolUseSummary(event)).toBe(false);
    });

    it("should match without preceding_tool_use_ids", () => {
      const event = {
        type: "tool_use_summary",
        summary: "Read file auth.ts",
      };
      expect(isToolUseSummary(event)).toBe(true);
    });
  });

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
      expect(isHookStarted({ type: "system", subtype: "hook_started", hook_id: "h1", hook_name: "SessionStart:startup", hook_event: "SessionStart" })).toBe(true);
    });
    it("returns false for other system events", () => {
      expect(isHookStarted({ type: "system", subtype: "task_started", task_id: "t1", description: "test" })).toBe(false);
    });
  });

  describe("isHookResponse", () => {
    it("returns true for valid hook_response event", () => {
      expect(isHookResponse({ type: "system", subtype: "hook_response", hook_id: "h1", hook_name: "SessionStart:startup", hook_event: "SessionStart" })).toBe(true);
    });
    it("returns false for non-hook events", () => {
      expect(isHookResponse({ type: "system", subtype: "hook_started", hook_id: "h1", hook_name: "test", hook_event: "test" })).toBe(false);
    });
  });
});
