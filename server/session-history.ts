import { getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

/**
 * Classify a user message into: "human", "command", "skip"
 * - human: actual user-typed text
 * - command: slash commands (/commit, /context-flow:cf, etc.)
 * - skip: tool_result, task-notification, system-reminder — noise
 */
function classifyUserMessage(rawMessage: unknown): "human" | "skip" {
  if (typeof rawMessage !== "object" || rawMessage === null) return "skip";

  const obj = rawMessage as Record<string, unknown>;
  const content = obj.content;

  // Array content: tool_result or image+text
  if (Array.isArray(content)) {
    if (content.some((b: any) => b.type === "tool_result")) return "skip";
    // Has text blocks (e.g. image+text messages) — treat as human
    if (content.some((b: any) => b.type === "text")) return "human";
    return "skip";
  }

  // String content: check for system/noise prefixes
  if (typeof content === "string") {
    if (content.includes("<task-notification>")) return "skip";
    if (content.includes("<local-command-caveat>")) return "skip";
    if (content.includes("<system-reminder>") && !content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim()) return "skip";
    // local-command-stdout is system output, not human input
    if (content.includes("<local-command-stdout>") && !content.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "").replace(/<[^>]+>/g, "").trim()) return "skip";
    // Commands are also user input, just with XML tags we'll clean up
    return "human";
  }

  return "skip";
}

/**
 * Check if an assistant message is a tool use (not text output).
 */
function isToolUse(rawMessage: unknown): boolean {
  if (typeof rawMessage !== "object" || rawMessage === null) return false;
  const obj = rawMessage as Record<string, unknown>;
  if (!Array.isArray(obj.content)) return false;
  return obj.content.length > 0 && obj.content.every(
    (block: any) => block.type === "tool_use" || block.type === "thinking"
  );
}

/**
 * Extract text content from a SessionMessage.
 * Strips internal XML tags, extracts command names, cleans up noise.
 */
function extractTextContent(rawMessage: unknown): string {
  if (typeof rawMessage === "string") return rawMessage;
  if (typeof rawMessage !== "object" || rawMessage === null) return "";

  const obj = rawMessage as Record<string, unknown>;

  if (typeof obj.content === "string") {
    let text = obj.content;

    // Extract command name if present (show as "/command-name args")
    const cmdMatch = text.match(/<command-name>(.*?)<\/command-name>/);
    if (cmdMatch) {
      const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s);
      const args = argsMatch?.[1]?.trim();
      return args ? `${cmdMatch[1]} ${args}` : cmdMatch[1];
    }

    // Strip all XML-like tags
    text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
    text = text.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
    text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "");
    text = text.replace(/<[^>]+>/g, "");
    return text.trim();
  }

  if (Array.isArray(obj.content)) {
    return obj.content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text || "")
      .join("");
  }

  return "";
}

/**
 * Load conversation history from a Claude Code session.
 * Returns human messages, command labels, and assistant text — filters out tool noise.
 */
export async function loadSessionHistory(
  sdkSessionId: string
): Promise<HistoryMessage[]> {
  const messages = await getSessionMessages(sdkSessionId);
  const result: HistoryMessage[] = [];

  for (const msg of messages) {
    if (msg.type === "user") {
      const kind = classifyUserMessage(msg.message);
      if (kind === "skip") continue;

      // human or command (both shown as user messages)
      const content = extractTextContent(msg.message);
      if (content) {
        result.push({ id: msg.uuid, role: "user", content, timestamp: Date.now() });
      }
    } else if (msg.type === "assistant") {
      if (isToolUse(msg.message)) continue;
      const content = extractTextContent(msg.message);
      if (content) {
        result.push({ id: msg.uuid, role: "assistant", content, timestamp: Date.now() });
      }
    }
  }

  return result;
}
