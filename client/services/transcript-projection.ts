import type { Message } from "../stores/app-store";

export type ProjectedPart =
  | { kind: "text"; text: string; stopReason?: string }
  | { kind: "thinking"; thinking: string; signature?: string }
  | { kind: "tool_use"; toolUseId: string; toolName: string; toolInput: Record<string, unknown> }
  | { kind: "tool_result"; toolUseId: string; text: string };

export type VisibilityLayer = "server-record" | "client-block";
export type ModeVerdict = "visible" | "hidden";

export type VisibilityRule = {
  id: string;
  layer: VisibilityLayer;
  /** Server-record rules name the record flag/branch; client-block rules name a block kind. */
  subject: string;
  modes?: { conversation: ModeVerdict; full: ModeVerdict };
};

/**
 * The written union of two layers that operate at different granularity.
 * L1 is server-side and record-unit; L2 is client-side and block-unit.
 * Ids must match docs/transcript-visibility.md.
 */
export const VISIBILITY_RULES: VisibilityRule[] = [
  { id: "L1-isSidechain", layer: "server-record", subject: "isSidechain" },
  { id: "L1-isMeta", layer: "server-record", subject: "isMeta" },
  { id: "L1-isCompactSummary", layer: "server-record", subject: "isCompactSummary" },
  { id: "L1-claude-type-not-user-assistant", layer: "server-record", subject: "claude-type-not-in-user-assistant" },
  { id: "L1-omp-type-not-message", layer: "server-record", subject: "omp-type-not-message" },
  { id: "L1-omp-role-not-user-assistant", layer: "server-record", subject: "omp-role-not-in-user-assistant" },
  { id: "L1-conversational-no-message-body", layer: "server-record", subject: "conversational-record-with-no-message-body" },
  {
    id: "L2-text",
    layer: "client-block",
    subject: "text",
    modes: { conversation: "visible", full: "visible" },
  },
  {
    id: "L2-thinking",
    layer: "client-block",
    subject: "thinking",
    modes: { conversation: "hidden", full: "visible" },
  },
  {
    id: "L2-tool_use",
    layer: "client-block",
    subject: "tool_use",
    modes: { conversation: "hidden", full: "visible" },
  },
  {
    id: "L2-tool_result",
    layer: "client-block",
    subject: "tool_result",
    modes: { conversation: "hidden", full: "visible" },
  },
  {
    id: "L2-command-wrappers",
    layer: "client-block",
    subject: "command-wrapper",
    modes: { conversation: "hidden", full: "hidden" },
  },
  {
    id: "L2-unrecognised-block",
    layer: "client-block",
    subject: "unrecognised",
    modes: { conversation: "hidden", full: "hidden" },
  },
];

function isWrapperText(s: string): boolean {
  return s.includes("<command-name>") || s.includes("<local-command-stdout>");
}

function stopReasonOf(message: Record<string, unknown> | undefined): string | undefined {
  if (!message) return undefined;
  const snake = message.stop_reason;
  if (typeof snake === "string") return snake;
  const camel = message.stopReason;
  if (typeof camel === "string") return camel;
  return undefined;
}

function toolResultText(block: Record<string, unknown>): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string"
        ? (c as { text: string }).text
        : ""))
      .join("");
  }
  if (typeof block.text === "string") return block.text;
  return "";
}

/**
 * Project a transcript chunk (or a live stream_chunk payload) into ordered
 * typed parts. Text blocks of one record join into a single text part at the
 * position of the first text block.
 */
export function projectChunk(chunk: Record<string, unknown>): ProjectedPart[] {
  if (chunk.type === "stream_event") {
    const event = chunk.event as Record<string, unknown> | undefined;
    if (!event) return [];
    if (event.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return [{ kind: "text", text: delta.text }];
      }
    }
    return [];
  }

  const message = chunk.message as Record<string, unknown> | undefined;
  const isUser = chunk.type === "user" || message?.role === "user";
  if (chunk.type !== "assistant" && !isUser) return [];
  if (!message) return [];

  const stopReason = stopReasonOf(message);

  if (typeof message.content === "string") {
    if (!message.content || isWrapperText(message.content)) return [];
    return [{ kind: "text", text: message.content, ...(stopReason ? { stopReason } : {}) }];
  }

  if (!Array.isArray(message.content)) return [];

  const blocks = message.content as Record<string, unknown>[];
  const joinedText = blocks
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (isWrapperText(joinedText)) return [];

  const parts: ProjectedPart[] = [];
  let textPart: { kind: "text"; text: string; stopReason?: string } | null = null;

  for (const block of blocks) {
    if (!block || typeof block.type !== "string") continue;
    if (block.type === "text") {
      const piece = typeof block.text === "string" ? block.text : "";
      if (!textPart) {
        textPart = { kind: "text", text: piece, ...(stopReason ? { stopReason } : {}) };
        parts.push(textPart);
      } else {
        textPart.text += piece;
      }
      continue;
    }
    if (block.type === "thinking") {
      parts.push({
        kind: "thinking",
        thinking: typeof block.thinking === "string" ? block.thinking : "",
        ...(typeof block.signature === "string" ? { signature: block.signature } : {}),
      });
      continue;
    }
    if (block.type === "tool_use") {
      parts.push({
        kind: "tool_use",
        toolUseId: typeof block.id === "string" ? block.id : "",
        toolName: typeof block.name === "string" ? block.name : "",
        toolInput: (block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : {}) as Record<string, unknown>,
      });
      continue;
    }
    if (block.type === "tool_result") {
      parts.push({
        kind: "tool_result",
        toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : typeof block.toolUseId === "string" ? block.toolUseId : "",
        text: toolResultText(block),
      });
    }
    // unrecognised types produce no part (L2-unrecognised-block)
  }

  return parts.filter((p) => !(p.kind === "text" && p.text === ""));
}

function roleForPart(chunk: Record<string, unknown>, part: ProjectedPart): Message["role"] {
  if (part.kind === "tool_result") return "user";
  if (part.kind === "text") {
    const message = chunk.message as { role?: string } | undefined;
    if (chunk.type === "user" || message?.role === "user") return "user";
  }
  return "assistant";
}

function contentForPart(part: ProjectedPart): string {
  if (part.kind === "text") return part.text;
  if (part.kind === "thinking") return part.thinking;
  if (part.kind === "tool_result") return part.text;
  return "";
}

export function transcriptPositionOf(chunk: Record<string, unknown>): { recordId?: string; seq?: number } {
  return {
    ...(typeof chunk.recordId === "string" ? { recordId: chunk.recordId } : {}),
    ...(typeof chunk.seq === "number" ? { seq: chunk.seq } : {}),
  };
}

/** One Message per projected part; `blockIndex` is the part's index in this record. */
export function messagesFromProjectedChunk(
  chunk: Record<string, unknown>,
  idFor: (part: ProjectedPart, index: number) => string,
  timestamp = Date.now(),
): Message[] {
  const parts = projectChunk(chunk);
  const position = transcriptPositionOf(chunk);
  return parts.map((part, blockIndex) => {
    const message: Message = {
      id: idFor(part, blockIndex),
      role: roleForPart(chunk, part),
      content: contentForPart(part),
      timestamp,
      blockIndex,
      ...position,
    };
    if (part.kind === "text" && part.stopReason) message.stopReason = part.stopReason;
    if (part.kind === "thinking") message.kind = "thinking";
    if (part.kind === "tool_use") {
      message.kind = "tool_use";
      message.toolName = part.toolName;
      message.toolInput = part.toolInput;
      message.toolUseId = part.toolUseId;
    }
    if (part.kind === "tool_result") {
      message.kind = "tool_result";
      message.toolUseId = part.toolUseId;
    }
    return message;
  });
}

/** Visible-text extraction for callers that still want a single string. */
export function extractTextFromChunk(chunk: Record<string, unknown>): string | null {
  const text = projectChunk(chunk).find((p) => p.kind === "text");
  return text?.text || null;
}
