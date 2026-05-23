import { Icon } from "../../design/icons";
import type { ActiveAgent, ActiveTool } from "../../stores/app-store";
import "./activity.css";

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function deriveMemoryLabel(input: Record<string, unknown> | undefined): {
  label: string;
  target: string | null;
} {
  const paths = Array.isArray(input?.paths) ? (input?.paths as unknown[]) : [];
  const count = typeof input?.count === "number" ? (input.count as number) : paths.length;

  if (count > 1) {
    return { label: `Recalled ${count} memories`, target: null };
  }
  if (count === 1) {
    const first = typeof paths[0] === "string" ? (paths[0] as string) : "";
    const synth = first.match(/^<synthesis:(.+)>$/);
    if (synth) {
      return { label: "Recalled memory synthesis", target: synth[1] };
    }
    return { label: "Recalled memory", target: first ? basename(first) : null };
  }
  return { label: "Recalled memory", target: null };
}

interface ActivityStripProps {
  tools: Map<string, ActiveTool>;
  agents?: Map<string, ActiveAgent>;
}

function getTargetHint(input?: Record<string, unknown>): string | null {
  if (!input) return null;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.command === "string") return input.command.split("\n")[0];
  if (typeof input.path === "string") return input.path;
  if (typeof input.pattern === "string") return input.pattern;
  return null;
}

function ToolRow({ tool, nested }: { tool: ActiveTool; nested?: boolean }) {
  if (tool.toolName === "Memory") {
    const { label, target } = deriveMemoryLabel(tool.input);
    return (
      <div className={`lin-activity-tool lin-activity-tool-memory${nested ? " is-nested" : ""}`}>
        <span className="lin-activity-tool-icon" aria-label="book">
          <Icon name="book" size={14} />
        </span>
        <div className="lin-activity-main">
          <div className="lin-activity-name">{label}</div>
          {target && (
            <div className="lin-activity-target" title={target}>
              {target}
            </div>
          )}
        </div>
      </div>
    );
  }

  const target = getTargetHint(tool.input);
  return (
    <div className={`lin-activity-tool${nested ? " is-nested" : ""}`}>
      <span className="lin-mini-ring" />
      <div className="lin-activity-main">
        <div className="lin-activity-name">{tool.toolName}</div>
        {target && (
          <div className="lin-activity-target" title={target}>
            {target}
          </div>
        )}
      </div>
      <div className="lin-activity-elapsed">
        {tool.elapsedSeconds === undefined ? "—" : `${tool.elapsedSeconds}s`}
      </div>
    </div>
  );
}

function formatTokens(n?: number): string | null {
  if (n === undefined) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function ActivityStrip({ tools, agents }: ActivityStripProps) {
  const agentList = agents ? Array.from(agents.entries()) : [];
  const liveAgents = agentList.filter(([, a]) => a.status === "running");
  // Only group sub-tools under a *running* agent — if the owning agent has
  // already completed/failed, render its lingering sub-tools at top level so
  // they remain visible until they themselves finish.
  const liveToolUseIds = new Set(
    liveAgents.map(([, a]) => a.toolUseId).filter((id): id is string => !!id),
  );

  const subToolsByParent = new Map<string, Array<[string, ActiveTool]>>();
  const orphanTools: Array<[string, ActiveTool]> = [];
  for (const entry of tools.entries()) {
    const [, tool] = entry;
    const parent = tool.parentToolUseId;
    if (parent && liveToolUseIds.has(parent)) {
      if (!subToolsByParent.has(parent)) subToolsByParent.set(parent, []);
      subToolsByParent.get(parent)?.push(entry);
    } else {
      orphanTools.push(entry);
    }
  }

  if (liveAgents.length === 0 && orphanTools.length === 0) return null;

  return (
    <div className="lin-activity" aria-label="Active tools and agents">
      {liveAgents.map(([taskId, agent]) => {
        const subs = (agent.toolUseId && subToolsByParent.get(agent.toolUseId)) || [];
        const tokens = formatTokens(agent.tokenCount);
        return (
          <div key={`agent-${taskId}`} className="lin-activity-agent">
            <div className="lin-activity-agent-head">
              <span className="lin-activity-agent-spark" aria-hidden>
                ✦
              </span>
              <div className="lin-activity-agent-main">
                <div className="lin-activity-agent-name">{agent.taskType || "Subagent"}</div>
                <div className="lin-activity-agent-desc" title={agent.description}>
                  {agent.description}
                </div>
              </div>
              <div className="lin-activity-agent-stats">
                {agent.toolCount !== undefined && <span>{agent.toolCount} tools</span>}
                {tokens && <span>{tokens} tok</span>}
              </div>
            </div>
            {subs.length > 0 && (
              <div className="lin-activity-agent-children">
                {subs.map(([id, tool]) => (
                  <ToolRow key={id} tool={tool} nested />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {orphanTools.map(([id, tool]) => (
        <ToolRow key={id} tool={tool} />
      ))}
    </div>
  );
}
