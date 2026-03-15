import { getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";

export type HistoryMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

/**
 * Extract text content from a SessionMessage.
 * Handles content arrays (filters type==='text') and string content.
 *
 * @param message - SessionMessage from SDK
 * @returns Extracted text content or empty string
 */
function extractMessageContent(message: SessionMessage): string {
  const { message: rawMessage } = message;

  // Handle content array structure
  if (
    typeof rawMessage === "object" &&
    rawMessage !== null &&
    "content" in rawMessage
  ) {
    const content = (rawMessage as any).content;

    if (Array.isArray(content)) {
      return content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text || "")
        .join("");
    }
  }

  // Handle string content
  if (typeof rawMessage === "string") {
    return rawMessage;
  }

  return "";
}

/**
 * Load conversation history from a Claude Code session.
 *
 * @param sdkSessionId - SDK session identifier
 * @returns Array of history messages in chronological order
 */
export async function loadSessionHistory(
  sdkSessionId: string
): Promise<HistoryMessage[]> {
  const messages = await getSessionMessages(sdkSessionId);

  return messages
    .map((msg) => {
      const content = extractMessageContent(msg);

      // Extract timestamp from message metadata if available
      let timestamp = Date.now();
      if (
        typeof msg.message === "object" &&
        msg.message !== null &&
        "timestamp" in msg.message
      ) {
        const ts = (msg.message as any).timestamp;
        if (typeof ts === "number") {
          timestamp = ts;
        }
      }

      return {
        id: msg.uuid,
        role: msg.type,
        content,
        timestamp,
      };
    })
    .filter((msg) => msg.content.length > 0);
}
