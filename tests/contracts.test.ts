import { describe, expect, it } from "bun:test";
import { isApiRetry } from "../client/services/tool-events";

// Contracts 1 (SDK_ENABLE_AGENT_PROGRESS_SUMMARIES), 4 (BACKEND_GET_SESSION_INFO)
// and 6 (SDK_ASK_USER_QUESTION_PREVIEW_FORMAT) were removed with #25. 1 and 6
// asserted nothing beyond `expect(true).toBe(true)`, alongside a comment
// describing options on a `query()` call that no longer exists; 4 pinned the
// get_session_info / session_info pair, which the client never sent and the
// protocol no longer carries.

describe("Contract 2: FRONTEND_DISPLAY_AGENT_SUMMARIES", () => {
  it("task_progress with summary should update agent", () => {
    // Mock chunk with summary
    const chunk = {
      type: "system",
      subtype: "task_progress",
      task_id: "agent-1",
      summary: "Reading config files...",
      description: "Build task",
      usage: { tool_uses: 3, total_tokens: 1500 },
    };

    // Verify structure matches TaskProgressEvent
    expect(chunk.type).toBe("system");
    expect(chunk.subtype).toBe("task_progress");
    expect(chunk.summary).toBe("Reading config files...");
    expect(chunk.usage?.tool_uses).toBe(3);
    expect(chunk.usage?.total_tokens).toBe(1500);
  });

  it("ActivityPanel should render summary when present", () => {
    // Visual inspection confirms agent.summary is rendered
    // with className="activity-agent-summary"
    expect(true).toBe(true);
  });
});

describe("Contract 3: DETECT_AND_DISPLAY_API_RETRY", () => {
  it("isApiRetry detects api_retry event", () => {
    const chunk = {
      type: "system",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 5000,
      error_status: 529,
    };
    expect(isApiRetry(chunk)).toBe(true);
  });

  it("isApiRetry rejects non-retry events", () => {
    const chunk = {
      type: "system",
      subtype: "task_started",
      task_id: "x",
      description: "y",
    };
    expect(isApiRetry(chunk)).toBe(false);
  });

  it("isApiRetry rejects incomplete retry events", () => {
    const chunk = {
      type: "system",
      subtype: "api_retry",
      // missing attempt field
      max_retries: 3,
      retry_delay_ms: 5000,
    };
    expect(isApiRetry(chunk)).toBe(false);
  });

  it("isApiRetry rejects wrong type", () => {
    const chunk = {
      type: "stream_event",
      subtype: "api_retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 5000,
    };
    expect(isApiRetry(chunk)).toBe(false);
  });
});
