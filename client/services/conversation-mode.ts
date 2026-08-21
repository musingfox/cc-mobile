import { createElement, type ReactElement } from "react";
import type { Message } from "../stores/app-store";

const TURN_ENDING = new Set(["end_turn", "stop_sequence", "stop"]);

function isMarker(message: Message): boolean {
  return message.kind === "compact_boundary" || message.kind === "permission_denied";
}

/**
 * A prompt is what the human typed. The projection hands tool_result parts
 * role "user" too (transcript-projection.ts `roleForPart`), so role alone
 * would let a tool's stdout open a turn — and be rendered as the user's own
 * bubble. The block kind is what separates the two.
 */
function isUserPrompt(message: Message): boolean {
  return message.role === "user" && message.kind !== "tool_result" && !isMarker(message);
}

function isTextBubble(message: Message): boolean {
  if (message.role !== "assistant") return false;
  if (message.kind === "thinking" || message.kind === "tool_use" || message.kind === "tool_result") {
    return false;
  }
  return true;
}

function pickAnswer(segment: Message[]): Message | undefined {
  let lastText: Message | undefined;
  let lastEnding: Message | undefined;
  for (const message of segment) {
    if (!isTextBubble(message)) continue;
    lastText = message;
    if (message.stopReason !== undefined && TURN_ENDING.has(message.stopReason)) {
      lastEnding = message;
    }
  }
  return lastEnding ?? lastText;
}

/**
 * Conversation reading mode: every user prompt, plus at most one final text
 * answer per turn. Turns are the segments between user prompts (lookahead to
 * the next user message). Markers pass through and do not split turns.
 */
export function selectConversationMessages(messages: Message[]): Message[] {
  const out: Message[] = [];
  let segment: Message[] = [];

  const flush = () => {
    const answer = pickAnswer(segment);
    for (const message of segment) {
      if (isMarker(message) || message === answer) out.push(message);
    }
    segment = [];
  };

  for (const message of messages) {
    if (isUserPrompt(message)) {
      flush();
      out.push(message);
      continue;
    }
    segment.push(message);
  }
  flush();
  return out;
}

function isToolUse(message: Message): boolean {
  return message.kind === "tool_use";
}

function isToolResult(message: Message): boolean {
  return message.kind === "tool_result";
}

function toolCard(fields: {
  id: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  content: string;
  toolUseId?: string;
  timestamp: number;
}): Message {
  return {
    id: fields.id,
    role: "tool",
    content: fields.content,
    timestamp: fields.timestamp,
    toolName: fields.toolName,
    toolInput: fields.toolInput,
    toolUseId: fields.toolUseId,
    kind: "tool_use",
  };
}

/**
 * Pair tool_use with tool_result by toolUseId at the render layer.
 * Recomputed from scratch every call so an unloaded older page cannot
 * leave a stale pairing in the store.
 */
export function mergeToolParts(messages: Message[]): Message[] {
  const uses = new Map<string, Message>();
  for (const message of messages) {
    if (isToolUse(message) && message.toolUseId && !uses.has(message.toolUseId)) {
      uses.set(message.toolUseId, message);
    }
  }

  const results = new Map<string, Message>();
  for (const message of messages) {
    if (isToolResult(message) && message.toolUseId && !results.has(message.toolUseId)) {
      results.set(message.toolUseId, message);
    }
  }

  const emitted = new Set<string>();
  const out: Message[] = [];

  for (const message of messages) {
    if (isToolUse(message)) {
      const id = message.toolUseId;
      if (id && emitted.has(id)) continue;
      if (id) emitted.add(id);
      const result = id ? results.get(id) : undefined;
      out.push(
        toolCard({
          id: message.id,
          toolName: message.toolName ?? "Tool",
          toolInput: message.toolInput,
          content: result?.content ?? "",
          toolUseId: id,
          timestamp: message.timestamp,
        }),
      );
      continue;
    }
    if (isToolResult(message)) {
      const id = message.toolUseId;
      if (id && uses.has(id)) continue;
      if (id && emitted.has(id)) continue;
      if (id) emitted.add(id);
      out.push(
        toolCard({
          id: message.id,
          toolName: "Tool result",
          content: message.content,
          toolUseId: id,
          timestamp: message.timestamp,
        }),
      );
      continue;
    }
    out.push(message);
  }

  return out;
}

/** Thinking in Full mode: collapsed by default, native disclosure. */
export function FullModeThinking({ text }: { text: string }): ReactElement {
  return createElement("details", null, createElement("summary", null, "Thinking"), text);
}
