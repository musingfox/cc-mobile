import type { Message } from "../stores/app-store";

const TURN_ENDING = new Set(["end_turn", "stop_sequence", "stop"]);

function isMarker(message: Message): boolean {
  return message.kind === "compact_boundary" || message.kind === "permission_denied";
}

function isUserPrompt(message: Message): boolean {
  return message.role === "user" && !isMarker(message);
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
