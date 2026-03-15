import { describe, it, expect } from "bun:test";
import { isToolProgress, isToolUseSummary, isTaskProgress } from "../services/tool-events";

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

    it("should return false for wrong field types", () => {
      const event = {
        type: "tool_progress",
        tool_use_id: 123, // should be string
        tool_name: "Read",
        parent_tool_use_id: null,
        elapsed_time_seconds: 1.5,
      };
      expect(isToolProgress(event)).toBe(false);
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

    it("should return false for non-array preceding_tool_use_ids", () => {
      const event = {
        type: "tool_use_summary",
        summary: "Read file auth.ts",
        preceding_tool_use_ids: "t123", // should be array
      };
      expect(isToolUseSummary(event)).toBe(false);
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
});
