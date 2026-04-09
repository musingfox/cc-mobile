export type ToolStartEvent = {
  type: "stream_event";
  event: {
    type: "content_block_start";
    content_block: {
      type: "tool_use";
      name: string;
      id: string;
    };
  };
};

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

export type TaskStartedEvent = {
  type: "system";
  subtype: "task_started";
  task_id: string;
  description: string;
  task_type?: string;
  tool_use_id?: string;
};

export type TaskProgressEvent = {
  type: "system";
  subtype: "task_progress";
  task_id?: string;
  description: string;
  last_tool_name?: string;
  summary?: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
  };
};

export type TaskNotificationEvent = {
  type: "system";
  subtype: "task_notification";
  task_id: string;
  status: "completed" | "failed" | "stopped";
  summary?: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
};

export type TerminalReason =
  | "blocking_limit"
  | "rapid_refill_breaker"
  | "prompt_too_long"
  | "image_error"
  | "model_error"
  | "aborted_streaming"
  | "aborted_tools"
  | "stop_hook_prevented"
  | "hook_stopped"
  | "tool_deferred"
  | "max_turns"
  | "completed";

export type ResultMessage = {
  type: "result";
  subtype: "success" | "error";
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  num_turns?: number;
  duration_ms?: number;
  is_error: boolean;
  error?: string;
  terminal_reason?: TerminalReason;
};

export function isToolStart(chunk: Record<string, unknown>): chunk is ToolStartEvent {
  if (chunk.type !== "stream_event") return false;
  const event = chunk.event as Record<string, unknown> | undefined;
  if (!event || event.type !== "content_block_start") return false;
  const block = event.content_block as Record<string, unknown> | undefined;
  return (
    block?.type === "tool_use" && typeof block.name === "string" && typeof block.id === "string"
  );
}

export function isToolProgress(chunk: Record<string, unknown>): chunk is ToolProgressEvent {
  return chunk.type === "tool_progress" && typeof chunk.tool_name === "string";
}

export function isToolUseSummary(chunk: Record<string, unknown>): chunk is ToolUseSummaryEvent {
  return chunk.type === "tool_use_summary" && typeof chunk.summary === "string";
}

export function isTaskStarted(chunk: Record<string, unknown>): chunk is TaskStartedEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "task_started" &&
    typeof chunk.task_id === "string" &&
    typeof chunk.description === "string"
  );
}

export function isTaskProgress(chunk: Record<string, unknown>): chunk is TaskProgressEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "task_progress" &&
    typeof chunk.description === "string"
  );
}

export function isTaskNotification(chunk: Record<string, unknown>): chunk is TaskNotificationEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "task_notification" &&
    typeof chunk.task_id === "string" &&
    typeof chunk.status === "string" &&
    ["completed", "failed", "stopped"].includes(chunk.status as string)
  );
}

export function isResultMessage(chunk: Record<string, unknown>): chunk is ResultMessage {
  return (
    chunk.type === "result" &&
    (chunk.subtype === "success" || chunk.subtype === "error") &&
    typeof chunk.is_error === "boolean"
  );
}

export type HookStartedEvent = {
  type: "system";
  subtype: "hook_started";
  hook_id: string;
  hook_name: string;
  hook_event: string;
};

export type HookResponseEvent = {
  type: "system";
  subtype: "hook_response";
  hook_id: string;
  hook_name: string;
  hook_event: string;
};

export function isHookStarted(chunk: Record<string, unknown>): chunk is HookStartedEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "hook_started" &&
    typeof chunk.hook_name === "string"
  );
}

export function isHookResponse(chunk: Record<string, unknown>): chunk is HookResponseEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "hook_response" &&
    typeof chunk.hook_name === "string"
  );
}

// Rate limit event from SDK
export type RateLimitEvent = {
  type: "rate_limit_event";
  rate_limit_info: {
    status: "allowed" | "allowed_warning" | "rejected";
    resetsAt?: number;
    rateLimitType?: string;
    utilization?: number;
    overageStatus?: string;
    overageResetsAt?: number;
    isUsingOverage?: boolean;
    surpassedThreshold?: number;
  };
};

export function isRateLimitEvent(chunk: Record<string, unknown>): chunk is RateLimitEvent {
  return chunk.type === "rate_limit_event" && typeof chunk.rate_limit_info === "object";
}

// Prompt suggestion from SDK (requires promptSuggestions: true in query options)
export type PromptSuggestionEvent = {
  type: "prompt_suggestion";
  suggestion: string;
};

export function isPromptSuggestion(chunk: Record<string, unknown>): chunk is PromptSuggestionEvent {
  return chunk.type === "prompt_suggestion" && typeof chunk.suggestion === "string";
}

// API retry event from SDK (retryable error with delay)
export type ApiRetryEvent = {
  type: "system";
  subtype: "api_retry";
  attempt: number;
  max_retries: number;
  retry_delay_ms: number;
  error_status: number | null;
};

export function isApiRetry(chunk: Record<string, unknown>): chunk is ApiRetryEvent {
  return (
    chunk.type === "system" && chunk.subtype === "api_retry" && typeof chunk.attempt === "number"
  );
}

// Session state changed event from SDK
export type SessionStateChangedEvent = {
  type: "system";
  subtype: "session_state_changed";
  state: "idle" | "running" | "requires_action";
};

const VALID_SESSION_STATES = new Set(["idle", "running", "requires_action"]);

export function isSessionStateChanged(
  chunk: Record<string, unknown>,
): chunk is SessionStateChangedEvent {
  return (
    chunk.type === "system" &&
    chunk.subtype === "session_state_changed" &&
    typeof chunk.state === "string" &&
    VALID_SESSION_STATES.has(chunk.state)
  );
}
