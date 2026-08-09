/**
 * TranscriptRecordToChunk — transcript record → the chunk the phone renders.
 *
 * Every input below is a shape the 2026-08-02 probe recorded (see
 * `fixtures/probe-session.jsonl`), trimmed to the fields the mapping reads.
 */

import { describe, expect, it } from "bun:test";
import { transcriptRecordToChunk } from "./records";

describe("TranscriptRecordToChunk", () => {
  it("passes an assistant tool_use through unchanged", () => {
    const record = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_01FV8",
            name: "Bash",
            input: { command: "whoami" },
          },
        ],
      },
      uuid: "73e1a695-4c0f-4d21-b58a-9e0f1a2b3c4d",
      sessionId: "a21273d4-77e6-43dc-b9cb-3647561d1192",
    };

    expect(transcriptRecordToChunk(record)).toEqual({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_01FV8",
            name: "Bash",
            input: { command: "whoami" },
          },
        ],
      },
      recordId: "73e1a695-4c0f-4d21-b58a-9e0f1a2b3c4d",
    });
  });

  it("passes a user tool_result through unchanged", () => {
    const record = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01FV8",
            content: "nickhuang",
            is_error: false,
          },
        ],
      },
      toolUseResult: { stdout: "nickhuang", stderr: "" },
    };

    expect(transcriptRecordToChunk(record)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_01FV8",
            content: "nickhuang",
            is_error: false,
          },
        ],
      },
    });
  });

  it("passes a plain human turn through unchanged", () => {
    expect(
      transcriptRecordToChunk({ type: "user", message: { role: "user", content: "hello" } }),
    ).toEqual({ type: "user", message: { role: "user", content: "hello" } });
  });

  it("keeps a thinking block with empty text and a long signature intact", () => {
    const signature = "EqQBCkYIBRgCKkDq0mHb3nQ8Yy1kZ0ZpS0hMTkxSaFVvUW5rZ3hUcU1sWTlOd1RtT3Jq";
    const chunk = transcriptRecordToChunk({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "", signature }],
      },
    });

    expect(chunk).toEqual({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "", signature }] },
    });
  });

  it("renders nothing for checkpointing, metadata and control records", () => {
    expect(transcriptRecordToChunk({ type: "file-history-snapshot" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "file-history-delta" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "system", subtype: "turn_duration" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "system", subtype: "compact_boundary" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "ai-title", title: "x" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "attachment" })).toBeNull();
  });

  it("renders nothing for a sub-agent's own turns", () => {
    expect(
      transcriptRecordToChunk({
        type: "assistant",
        isSidechain: true,
        message: { role: "assistant", content: [{ type: "text", text: "sub-agent thinking" }] },
      }),
    ).toBeNull();
    expect(
      transcriptRecordToChunk({
        type: "user",
        isSidechain: true,
        message: { role: "user", content: "the Task prompt" },
      }),
    ).toBeNull();
  });

  it("still renders a main-agent turn that carries isSidechain: false", () => {
    expect(
      transcriptRecordToChunk({
        type: "user",
        isSidechain: false,
        message: { role: "user", content: "hello" },
      }),
    ).toEqual({ type: "user", message: { role: "user", content: "hello" } });
  });

  it("renders nothing for text claude injected on the user's behalf", () => {
    expect(
      transcriptRecordToChunk({
        type: "user",
        isMeta: true,
        message: {
          role: "user",
          content: [
            { type: "text", text: "<local-command-caveat>Caveat: …</local-command-caveat>" },
          ],
        },
      }),
    ).toBeNull();
  });

  it("renders nothing for the post-compaction continuation record", () => {
    expect(
      transcriptRecordToChunk({
        type: "user",
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
        message: {
          role: "user",
          content: "This session is being continued from a previous conversation…",
        },
      }),
    ).toBeNull();
  });

  it("renders nothing for an unrecognised or malformed record", () => {
    expect(transcriptRecordToChunk({ type: "brand-new-record-kind" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "assistant" })).toBeNull();
    expect(transcriptRecordToChunk("nope")).toBeNull();
    expect(transcriptRecordToChunk(null)).toBeNull();
  });
});

/**
 * The same function reading omp's vocabulary. Every record below is a real
 * shape from an omp transcript on this machine (2026-08-06), trimmed to the
 * fields the mapping reads.
 */
describe("TranscriptRecordToChunk — omp", () => {
  it("turns an omp assistant message into the envelope the client already renders", () => {
    const record = {
      type: "message",
      id: "c03690ca",
      parentId: "dc4be613",
      timestamp: "2026-08-05T07:12:41.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "weighing it up" },
          { type: "text", text: "Done.", textSignature: "sig" },
        ],
      },
    };

    // `type` becomes the role, which is what the client's dispatcher switches
    // on; the message rides through verbatim, thinking block and all.
    expect(transcriptRecordToChunk(record)).toEqual({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "weighing it up" },
          { type: "text", text: "Done.", textSignature: "sig" },
        ],
      },
      recordId: "c03690ca",
    });
  });

  it("turns an omp user message into a user chunk", () => {
    expect(
      transcriptRecordToChunk({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Reply with exactly: ACP-E1-OK" }],
        },
      }),
    ).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Reply with exactly: ACP-E1-OK" }] },
    });
  });

  it("renders nothing for omp's non-conversational roles", () => {
    // The client renders text blocks on assistant records and nothing else, so
    // these would be invisible traffic rather than visible content.
    for (const role of ["toolResult", "developer", "fileMention", "bashExecution"]) {
      expect(
        transcriptRecordToChunk({ type: "message", message: { role, content: [] } }),
      ).toBeNull();
    }
  });

  it("renders nothing for omp's bookkeeping records", () => {
    // All eleven types observed across this machine's omp transcripts, minus
    // `message`. credential_pin carries a provider + hash; custom_message is
    // advisor/plugin output that would otherwise read as the agent speaking.
    const bookkeeping = [
      { type: "credential_pin", provider: "xai-oauth", hash: "7ae00c2f" },
      { type: "custom", customType: "session_exit", data: { reason: "sigterm" } },
      { type: "custom_message", customType: "advisor", content: "<advisory/>", display: true },
      { type: "custom_message", customType: "advisor", content: "hidden", display: false },
      { type: "session", cwd: "/repo" },
      { type: "title", title: "a chat" },
      { type: "title_change", title: "a chat" },
      { type: "model_change", model: "grok" },
      { type: "thinking_level_change", level: "high" },
      { type: "compaction" },
      { type: "service_tier_change" },
      { type: "ttsr_injection" },
    ];

    for (const record of bookkeeping) {
      expect(transcriptRecordToChunk(record)).toBeNull();
    }
  });

  it("renders nothing for a malformed omp record", () => {
    expect(transcriptRecordToChunk({ type: "message" })).toBeNull();
    expect(transcriptRecordToChunk({ type: "message", message: null })).toBeNull();
    expect(transcriptRecordToChunk({ type: "message", message: { content: [] } })).toBeNull();
  });
});

describe("TranscriptChunkRecordId", () => {
  it("T1: given {uuid:\"u1\", type:\"assistant\", message:{role:\"assistant\", content:[{type:\"text\", text:\"hi\"}]}} -> expect {type:\"assistant\", message:{…}, recordId:\"u1\"}", () => {
    const record = {
      uuid: "u1",
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
    };
    expect(transcriptRecordToChunk(record)).toEqual({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      recordId: "u1",
    });
  });

  it("T2: given {id:\"o1\", type:\"message\", message:{role:\"user\", content:\"hi\"}} -> expect {type:\"user\", message:{…}, recordId:\"o1\"}", () => {
    const record = {
      id: "o1",
      type: "message",
      message: { role: "user", content: "hi" },
    };
    expect(transcriptRecordToChunk(record)).toEqual({
      type: "user",
      message: { role: "user", content: "hi" },
      recordId: "o1",
    });
  });

  it("T3: given {uuid:\"u2\", type:\"user\", isMeta:true, message:{…}} -> expect null", () => {
    const record = {
      uuid: "u2",
      type: "user",
      isMeta: true,
      message: { role: "user", content: "injected" },
    };
    expect(transcriptRecordToChunk(record)).toBeNull();
  });

  it("T4: given {type:\"assistant\", message:{…}} with no uuid and no id -> expect a chunk where \"recordId\" in chunk === false (absent, not undefined)", () => {
    const record = {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "no id" }] },
    };
    const chunk = transcriptRecordToChunk(record);
    expect(chunk).not.toBeNull();
    expect("recordId" in (chunk as any)).toBe(false);
  });

  it("T5: given a record that is not an object (42) -> expect null, no throw", () => {
    expect(() => transcriptRecordToChunk(42 as any)).not.toThrow();
    expect(transcriptRecordToChunk(42 as any)).toBeNull();
  });
});
