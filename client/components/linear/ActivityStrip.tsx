import type { ActiveTool } from "../../stores/app-store";
import "./activity.css";

interface ActivityStripProps {
  tools: Map<string, ActiveTool>;
}

function getTargetHint(input?: Record<string, unknown>): string | null {
  if (!input) return null;
  if (typeof input.file_path === "string") return input.file_path;
  if (typeof input.command === "string") return input.command.split("\n")[0];
  if (typeof input.path === "string") return input.path;
  return null;
}

export default function ActivityStrip({ tools }: ActivityStripProps) {
  if (tools.size === 0) return null;

  return (
    <div className="lin-activity" aria-label="Active tools">
      {Array.from(tools.entries()).map(([id, tool]) => {
        const target = getTargetHint(tool.input);
        return (
          <div key={id} className="lin-activity-card">
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
      })}
    </div>
  );
}
