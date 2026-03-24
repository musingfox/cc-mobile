import { useState } from "react";
import type { ResolvedAction } from "../stores/app-store";

function formatParams(toolName: string, parameters: Record<string, unknown>): string {
  if (toolName === "Bash" && parameters.command) return String(parameters.command);
  if (parameters.file_path) return String(parameters.file_path);
  if (parameters.pattern) return String(parameters.pattern);
  if (toolName === "AskUserQuestion") {
    const questions = parameters.questions as Array<{ question?: string }> | undefined;
    return questions?.[0]?.question || "Question";
  }
  const first = Object.values(parameters).find((v) => typeof v === "string" && v.length < 200);
  return typeof first === "string" ? first : "";
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : `${str.slice(0, max)}…`;
}

const resolutionConfig = {
  approved: { label: "Approved", icon: "✓", cls: "approved" },
  denied: { label: "Denied", icon: "✕", cls: "denied" },
  answered: { label: "Answered", icon: "↩", cls: "answered" },
} as const;

export default function ResolvedActionChip({ action }: { action: ResolvedAction }) {
  const [expanded, setExpanded] = useState(false);

  if (action.type === "permission") {
    const config = resolutionConfig[action.resolution];
    const paramStr = formatParams(action.toolName, action.parameters);

    return (
      <div className={`resolved-chip resolved-chip--${config.cls}`}>
        <button
          type="button"
          className="resolved-chip-header"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="resolved-chip-icon">{config.icon}</span>
          <span className="resolved-chip-tool">{action.toolName}</span>
          <span className={`resolved-chip-badge resolved-chip-badge--${config.cls}`}>
            {config.label}
          </span>
          <span className="resolved-chip-time">
            {new Date(action.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </button>
        {expanded && (
          <div className="resolved-chip-detail">
            {paramStr && <code className="resolved-chip-params">{truncate(paramStr, 120)}</code>}
            {action.answer && (
              <div className="resolved-chip-answer">
                <span className="resolved-chip-answer-label">Answer:</span> {action.answer}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Activity type
  const toolCount = action.tools.length;
  const agentCount = action.agents.length;
  const summary =
    agentCount > 0
      ? action.agents.map((a) => a.description).join(", ")
      : action.tools.map((t) => t.toolName).join(", ");

  return (
    <div className="resolved-chip resolved-chip--activity">
      <button type="button" className="resolved-chip-header" onClick={() => setExpanded(!expanded)}>
        <span className="resolved-chip-icon">⚡</span>
        <span className="resolved-chip-tool">
          {agentCount > 0 ? `${agentCount} agent${agentCount > 1 ? "s" : ""}` : ""}
          {agentCount > 0 && toolCount > 0 ? " · " : ""}
          {toolCount > 0 ? `${toolCount} tool${toolCount > 1 ? "s" : ""}` : ""}
        </span>
        <span className="resolved-chip-badge resolved-chip-badge--activity">Done</span>
        <span className="resolved-chip-time">
          {new Date(action.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </button>
      {expanded && (
        <div className="resolved-chip-detail">
          <span className="resolved-chip-summary">{truncate(summary, 150)}</span>
          {action.agents.map((a) => (
            <div key={a.description} className="resolved-chip-agent-stat">
              <span>{a.description}</span>
              {a.toolCount != null && (
                <span className="resolved-chip-stat">{a.toolCount} tools</span>
              )}
              {a.tokenCount != null && (
                <span className="resolved-chip-stat">{a.tokenCount.toLocaleString()} tokens</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
