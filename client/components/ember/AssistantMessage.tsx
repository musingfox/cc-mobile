import MarkdownRenderer from "../MarkdownRenderer";
import Avatar from "./Avatar";
import StreamingCursor from "./StreamingCursor";

interface AssistantMessageProps {
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AssistantMessage({
  content,
  timestamp,
  isStreaming,
}: AssistantMessageProps) {
  return (
    <div className="ember-message ember-message--assistant">
      <div
        className={`ember-message-avatar ${isStreaming ? "ember-avatar--streaming" : ""}`}
        aria-label="Assistant"
      >
        <Avatar label="CL" size={22} variant="gradient" />
      </div>
      <div className="ember-message-body">
        <div className="ember-message-content">
          <MarkdownRenderer content={content} isStreaming={!!isStreaming} />
          {isStreaming && <StreamingCursor />}
        </div>
        <div className="ember-message-timestamp">{formatTimestamp(timestamp)}</div>
      </div>
    </div>
  );
}
