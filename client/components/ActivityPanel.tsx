import { useEffect, useState } from "react";
import type { ActiveTool, ActiveAgent } from "../stores/app-store";

type ActivityPanelProps = {
  activeTools: Map<string, ActiveTool>;
  activeAgents: Map<string, ActiveAgent>;
  activeHook?: { hookId: string; hookName: string } | null;
};

export default function ActivityPanel({ activeTools, activeAgents, activeHook }: ActivityPanelProps) {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update elapsed time every second
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

  // Filter only running agents (exclude completed/failed)
  const runningAgents = Array.from(activeAgents.entries()).filter(
    ([, agent]) => agent.status === "running"
  );

  // Show nothing if no active items
  if (activeTools.size === 0 && runningAgents.length === 0 && !activeHook) {
    return null;
  }

  return (
    <div className="activity-panel">
      {/* Active Hook */}
      {activeHook && (
        <div className="activity-hook">
          <span className="activity-hook-name">Hook: {activeHook.hookName}</span>
        </div>
      )}

      {/* Active Agents */}
      {runningAgents.map(([taskId, agent]) => {
        // Find tools that belong to this agent
        const childTools = Array.from(activeTools.entries()).filter(
          ([, tool]) => tool.parentToolUseId === taskId
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
                  <span className="activity-stat">
                    Tools: {agent.toolCount}
                  </span>
                )}
                {agent.tokenCount !== undefined && (
                  <span className="activity-stat">
                    Tokens: {agent.tokenCount.toLocaleString()}
                  </span>
                )}
              </div>
            )}
            {/* Nested tools under this agent */}
            {childTools.length > 0 && (
              <div className="activity-nested-tools">
                {childTools.map(([toolId, tool]) => (
                  <div key={toolId} className="activity-tool nested">
                    <span className="activity-tool-name">{tool.toolName}</span>
                    <span className="activity-tool-elapsed">
                      {tool.elapsedSeconds !== undefined
                        ? `${Math.floor(tool.elapsedSeconds)}s`
                        : formatElapsed(tool.startedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Root-level tools (no parent agent) */}
      {Array.from(activeTools.entries())
        .filter(([, tool]) => !tool.parentToolUseId)
        .map(([toolId, tool]) => (
          <div key={toolId} className="activity-tool">
            <span className="activity-tool-name">{tool.toolName}</span>
            <span className="activity-tool-elapsed">
              {tool.elapsedSeconds !== undefined
                ? `${Math.floor(tool.elapsedSeconds)}s`
                : formatElapsed(tool.startedAt)}
            </span>
          </div>
        ))}
    </div>
  );
}
