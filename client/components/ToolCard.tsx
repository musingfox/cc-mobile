import Ansi from "ansi-to-react";
import { useState } from "react";
import { darkStyles, defaultStyles, JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { getToolDefinition } from "../services/tool-registry";
import { useSettingsStore } from "../stores/settings-store";
import DiffView from "./DiffView";

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

/** Try to parse JSON, returns parsed object or null */
function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Check if text contains ANSI escape sequences */
function hasAnsiCodes(text: string): boolean {
  return text.includes("\x1b[") || text.includes("\u001b[");
}

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
  const theme = useSettingsStore((s) => s.theme);

  const [diffCollapsed, setDiffCollapsed] = useState(true);

  // Check if this is an edit-type tool
  const isEditTool = toolName === "Edit" && "old_string" in input && "new_string" in input;

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
          {isEditTool ? (
            <DiffView
              oldString={String(input.old_string ?? "")}
              newString={String(input.new_string ?? "")}
              filePath={typeof input.file_path === "string" ? input.file_path : undefined}
              collapsed={diffCollapsed}
              onToggle={() => setDiffCollapsed(!diffCollapsed)}
            />
          ) : (
            <ToolOutput content={content} toolName={toolName} theme={theme} />
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/** Renders tool output with auto-detection: JSON tree > ANSI > plain text */
function ToolOutput({
  content,
  toolName: _toolName,
  theme,
}: {
  content: string;
  toolName: string;
  theme: string;
}) {
  // 1. Try JSON tree view
  const parsed = tryParseJson(content);
  if (parsed !== null) {
    return (
      <div className="tool-output-json">
        <JsonView
          data={parsed}
          style={theme === "light" ? defaultStyles : darkStyles}
          shouldExpandNode={(level) => level < 2}
        />
      </div>
    );
  }

  // 2. Try ANSI rendering
  if (hasAnsiCodes(content)) {
    return (
      <pre className="tool-output-ansi">
        <Ansi>{content}</Ansi>
      </pre>
    );
  }

  // 3. Plain text fallback
  return <pre className="tool-card-output">{content}</pre>;
}
