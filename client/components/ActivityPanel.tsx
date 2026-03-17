import { useEffect, useState } from "react";
import type { ActiveAgent, ActiveTool } from "../stores/app-store";

type ActivityPanelProps = {
  activeTools: Map<string, ActiveTool>;
  activeAgents: Map<string, ActiveAgent>;
  activeHook?: { hookId: string; hookName: string } | null;
};

const TOOL_ICONS: Record<string, string> = {
  Read: "eye",
  Write: "pencil",
  Edit: "pencil",
  MultiEdit: "pencil",
  Bash: "terminal",
  Grep: "search",
  Glob: "folder",
  Agent: "cpu",
  Skill: "zap",
  WebFetch: "globe",
  WebSearch: "globe",
  NotebookEdit: "file-text",
};

function getToolIcon(toolName: string): string {
  return TOOL_ICONS[toolName] ?? "tool";
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}...`;
}

function getToolDetail(toolName: string, input?: Record<string, unknown>): string | null {
  if (!input) return null;

  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      if (typeof input.file_path === "string") return input.file_path;
      break;
    case "Bash":
      if (typeof input.command === "string") return truncate(input.command, 60);
      if (typeof input.description === "string") return input.description;
      break;
    case "Grep":
      if (typeof input.pattern === "string") {
        const path = typeof input.path === "string" ? ` in ${input.path}` : "";
        return truncate(`/${input.pattern}/${path}`, 60);
      }
      break;
    case "Glob":
      if (typeof input.pattern === "string") return input.pattern;
      break;
    case "Agent":
      if (typeof input.description === "string") return input.description;
      if (typeof input.prompt === "string") return truncate(input.prompt, 60);
      break;
    case "Skill":
      if (typeof input.skill === "string") return input.skill;
      break;
    case "WebFetch":
      if (typeof input.url === "string") return truncate(input.url, 50);
      break;
    case "WebSearch":
      if (typeof input.query === "string") return input.query;
      break;
  }

  for (const val of Object.values(input)) {
    if (typeof val === "string" && val.length > 0 && val.length < 200) {
      return truncate(val, 60);
    }
  }
  return null;
}

function ToolItem({
  tool,
  elapsed,
  nested,
}: {
  tool: ActiveTool;
  elapsed: string;
  nested?: boolean;
}) {
  const detail = getToolDetail(tool.toolName, tool.input);
  const icon = getToolIcon(tool.toolName);

  return (
    <div className={`activity-tool-card ${nested ? "nested" : ""}`}>
      <div className="activity-tool-card-header">
        <span className="activity-tool-icon" data-icon={icon} />
        <span className="activity-tool-name">{tool.toolName}</span>
        <span className="activity-tool-elapsed">{elapsed}</span>
      </div>
      {detail && <div className="activity-tool-detail">{detail}</div>}
    </div>
  );
}

export default function ActivityPanel({
  activeTools,
  activeAgents,
  activeHook,
}: ActivityPanelProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatElapsed = (startedAt: number): string => {
    const elapsed = Math.floor((currentTime - startedAt) / 1000);
    if (elapsed < 60) return `${elapsed}s`;
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}m ${seconds}s`;
  };

  const getElapsed = (tool: ActiveTool): string =>
    tool.elapsedSeconds !== undefined
      ? `${Math.floor(tool.elapsedSeconds)}s`
      : formatElapsed(tool.startedAt);

  const runningAgents = Array.from(activeAgents.entries()).filter(
    ([, agent]) => agent.status === "running",
  );

  if (activeTools.size === 0 && runningAgents.length === 0 && !activeHook) {
    return null;
  }

  const rootTools = Array.from(activeTools.entries()).filter(([, tool]) => !tool.parentToolUseId);

  return (
    <div className="activity-panel">
      <span className="activity-panel-label">Activity</span>
      <div className="activity-panel-items">
        {/* Active Hook */}
        {activeHook && (
          <div className="activity-hook">
            <span className="activity-hook-name">Hook: {activeHook.hookName}</span>
          </div>
        )}

        {/* Active Agents */}
        {!activeHook &&
          runningAgents.map(([taskId, agent]) => {
            const childTools = Array.from(activeTools.entries()).filter(
              ([, tool]) => tool.parentToolUseId === taskId,
            );

            return (
              <div key={taskId} className="activity-agent">
                <div className="activity-agent-header">
                  <span className="activity-agent-status running">Running</span>
                  <span className="activity-agent-description">{agent.description}</span>
                </div>
                {(agent.toolCount !== undefined || agent.tokenCount !== undefined) && (
                  <div className="activity-agent-stats">
                    {agent.toolCount !== undefined && (
                      <span className="activity-stat">Tools: {agent.toolCount}</span>
                    )}
                    {agent.tokenCount !== undefined && (
                      <span className="activity-stat">
                        Tokens: {agent.tokenCount.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
                {childTools.length > 0 && (
                  <div className="activity-nested-tools">
                    {childTools.map(([toolId, tool]) => (
                      <ToolItem key={toolId} tool={tool} elapsed={getElapsed(tool)} nested />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        {/* Root-level tools */}
        {!activeHook &&
          rootTools.map(([toolId, tool]) => (
            <ToolItem key={toolId} tool={tool} elapsed={getElapsed(tool)} />
          ))}
      </div>
    </div>
  );
}
