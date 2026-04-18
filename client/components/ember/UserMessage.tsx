import type { ContentBlock } from "../../../server/protocol";

interface UserMessageProps {
  content: string;
  timestamp: number;
  contentBlocks?: ContentBlock[];
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserMessage({ content, timestamp, contentBlocks }: UserMessageProps) {
  return (
    <div className="ember-message ember-message--user">
      <div className="ember-message-bubble ember-message-bubble--user">
        <div className="ember-message-content">{content}</div>
        {contentBlocks && (
          <div className="ember-message-attachments">
            {contentBlocks
              .filter((block) => block.type === "image")
              .map((block, idx) => (
                <img
                  key={idx}
                  src={`data:${block.source.media_type};base64,${block.source.data}`}
                  alt="Attachment"
                  className="ember-message-attachment-image"
                />
              ))}
          </div>
        )}
      </div>
      <div className="ember-message-timestamp">{formatTimestamp(timestamp)}</div>
    </div>
  );
}
