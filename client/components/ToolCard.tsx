import { getToolDefinition } from "../services/tool-registry";

type ToolCardProps = {
  toolName: string;
  input: Record<string, unknown>;
  content: string;
  elapsedSeconds?: number;
  isRunning?: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode; // For permission footer slot
};

export default function ToolCard({
  toolName,
  input,
  content,
  elapsedSeconds,
  isRunning,
  expanded,
  onToggle,
  children,
}: ToolCardProps) {
  const toolDef = getToolDefinition(toolName);
  const icon = toolDef?.icon || "🔧";
  const title = toolDef?.title(input) || toolName;

  return (
    <div className="tool-card">
      <button type="button" className="tool-card-header" onClick={onToggle}>
        <span className="tool-card-expand-icon">{expanded ? "▼" : "▶"}</span>
        <span className="tool-card-icon">{icon}</span>
        <span className="tool-card-title">{title}</span>
        {isRunning && elapsedSeconds !== undefined && (
          <span className="tool-card-elapsed">
            {elapsedSeconds < 60
              ? `${Math.floor(elapsedSeconds)}s`
              : `${Math.floor(elapsedSeconds / 60)}m ${Math.floor(elapsedSeconds % 60)}s`}
          </span>
        )}
        {isRunning && <span className="tool-card-spinner">⏳</span>}
      </button>
      {expanded && (
        <div className="tool-card-content">
          <pre className="tool-card-output">{content}</pre>
          {children}
        </div>
      )}
    </div>
  );
}
