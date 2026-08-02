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
