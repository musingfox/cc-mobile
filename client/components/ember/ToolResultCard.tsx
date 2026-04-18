import { File, FileCode, FileEdit, Search, Terminal, Wrench } from "lucide-react";
import DiffView from "../DiffView";

interface ToolResultCardProps {
  toolName: string;
  input?: unknown;
  result?: string | unknown;
  elapsed?: number;
  expanded: boolean;
  onToggle: () => void;
  lineCount?: number;
}

function getToolIcon(toolName: string): React.ReactNode {
  const iconSize = 16;
  switch (toolName) {
    case "Edit":
    case "MultiEdit":
      return <FileEdit size={iconSize} />;
    case "Read":
      return <File size={iconSize} />;
    case "Grep":
      return <Search size={iconSize} />;
    case "Bash":
      return <Terminal size={iconSize} />;
    case "Write":
    case "NotebookEdit":
      return <FileCode size={iconSize} />;
    default:
      return <Wrench size={iconSize} />;
  }
}

function getToolIconColor(toolName: string): string {
  switch (toolName) {
    case "Edit":
    case "MultiEdit":
      return "var(--accent-primary)";
    case "Grep":
      return "var(--accent-success)";
    case "Read":
      return "var(--text-secondary)";
    case "Bash":
      return "var(--ember-amber-deep)";
    case "Agent":
    case "Skill":
      return "var(--accent-agent)";
    default:
      return "var(--text-secondary)";
  }
}

function formatElapsed(elapsedSeconds: number): string {
  if (elapsedSeconds < 60) {
    return `${Math.floor(elapsedSeconds)}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = Math.floor(elapsedSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

function extractLineCount(result: unknown): number {
  if (typeof result === "string") {
    return result.split("\n").length;
  }
  return 0;
}

export default function ToolResultCard({
  toolName,
  input,
  result,
  elapsed,
  expanded,
  onToggle,
  lineCount: providedLineCount,
}: ToolResultCardProps) {
  const iconColor = getToolIconColor(toolName);
  const lineCount = providedLineCount ?? extractLineCount(result);
  const isEditTool =
    toolName === "Edit" &&
    typeof input === "object" &&
    input !== null &&
    "old_string" in input &&
    "new_string" in input;

  const metadata = [toolName.toLowerCase()];
  if (lineCount > 0) {
    metadata.push(`${lineCount} lines`);
  }

  return (
    <div className="ember-tool-card">
      <button type="button" className="ember-tool-card-header" onClick={onToggle}>
        <div className="ember-tool-card-icon" style={{ color: iconColor }}>
          {getToolIcon(toolName)}
        </div>
        <div className="ember-tool-card-title">{toolName}</div>
        <div className="ember-tool-card-metadata">{metadata.join(" · ")}</div>
        {elapsed !== undefined && (
          <div className="ember-tool-card-elapsed">{formatElapsed(elapsed)}</div>
        )}
        <div className="ember-tool-card-expand-indicator">{expanded ? "−" : "+"}</div>
      </button>
      {expanded && (
        <div className="ember-tool-card-body">
          {isEditTool ? (
            <DiffView
              oldString={String((input as { old_string?: unknown }).old_string ?? "") as string}
              newString={String((input as { new_string?: unknown }).new_string ?? "") as string}
              filePath={
                typeof (input as { file_path?: unknown }).file_path === "string"
                  ? (input as { file_path: string }).file_path
                  : undefined
              }
              collapsed={false}
              onToggle={() => {}}
            />
          ) : (
            <pre className="ember-tool-card-output">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
