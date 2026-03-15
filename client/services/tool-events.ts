export type ToolProgressEvent = {
  type: "tool_progress";
  tool_use_id: string;
  tool_name: string;
  parent_tool_use_id: string | null;
  elapsed_time_seconds: number;
};

export type ToolUseSummaryEvent = {
  type: "tool_use_summary";
  summary: string;
  preceding_tool_use_ids: string[];
};

export type TaskProgressEvent = {
  type: "system";
  subtype: "task_progress";
  description: string;
  last_tool_name?: string;
  summary?: string;
};

export function isToolProgress(
  chunk: Record<string, unknown>
): chunk is ToolProgressEvent {
  return (
    chunk.type === "tool_progress" &&
    typeof chunk.tool_use_id === "string" &&
    typeof chunk.tool_name === "string" &&
    (chunk.parent_tool_use_id === null ||
      typeof chunk.parent_tool_use_id === "string") &&
    typeof chunk.elapsed_time_seconds === "number"
  );
}

export function isToolUseSummary(
  chunk: Record<string, unknown>
): chunk is ToolUseSummaryEvent {
  return (
    chunk.type === "tool_use_summary" &&
    typeof chunk.summary === "string" &&
    Array.isArray(chunk.preceding_tool_use_ids) &&
    chunk.preceding_tool_use_ids.every((id) => typeof id === "string")
  );
}

export function isTaskProgress(
  chunk: Record<string, unknown>
): chunk is TaskProgressEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "task_progress" &&
    typeof chunk.description === "string" &&
    (chunk.last_tool_name === undefined ||
      typeof chunk.last_tool_name === "string") &&
    (chunk.summary === undefined || typeof chunk.summary === "string")
  );
}
