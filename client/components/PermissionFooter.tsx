import { useState } from "react";
import { hapticService } from "../services/haptic";
import { useSettingsStore } from "../stores/settings-store";

type PermissionFooterProps = {
  toolName: string;
  parameters: Record<string, unknown>;
  onRespond: (action: "approve" | "approve_session" | "deny") => void;
};

function formatParams(toolName: string, parameters: Record<string, unknown>): string {
  if (toolName === "Bash" && parameters.command) {
    return String(parameters.command);
  }
  if (toolName === "Read" && parameters.file_path) {
    return String(parameters.file_path);
  }
  if (toolName === "Edit" && parameters.file_path) {
    return String(parameters.file_path);
  }
  if (toolName === "Write" && parameters.file_path) {
    return String(parameters.file_path);
  }
  if (toolName === "Glob" && parameters.pattern) {
    return String(parameters.pattern);
  }
  if (toolName === "Grep" && parameters.pattern) {
    return String(parameters.pattern);
  }
  const keys = Object.keys(parameters);
  if (keys.length === 0) return "";
  const first = parameters[keys[0]];
  return typeof first === "string" ? first : JSON.stringify(first);
}

export default function PermissionFooter({
  toolName,
  parameters,
  onRespond,
}: PermissionFooterProps) {
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const paramSummary = formatParams(toolName, parameters);

  const handleClick = (action: "approve" | "approve_session" | "deny") => {
    const hapticsEnabled = useSettingsStore.getState().hapticsEnabled;
    if (hapticsEnabled && hapticService.isSupported()) {
      if (action === "deny") {
        hapticService.vibrate([30, 20, 30]);
      } else {
        hapticService.vibrate(50);
      }
    }
    setSelectedAction(action);
    onRespond(action);
  };

  return (
    <div className="permission-footer">
      <div className="permission-tool-info">
        <span className="permission-tool-name">{toolName}</span>
        {paramSummary && <code className="permission-tool-params">{paramSummary}</code>}
      </div>
      <div className="permission-actions">
        <button
          type="button"
          className={`permission-btn green ${selectedAction === "approve" ? "selected" : ""} ${selectedAction && selectedAction !== "approve" ? "unselected" : ""}`}
          onClick={() => handleClick("approve")}
        >
          Yes
        </button>
        <button
          type="button"
          className={`permission-btn blue ${selectedAction === "approve_session" ? "selected" : ""} ${selectedAction && selectedAction !== "approve_session" ? "unselected" : ""}`}
          onClick={() => handleClick("approve_session")}
        >
          Allow in this session
        </button>
        <button
          type="button"
          className={`permission-btn red ${selectedAction === "deny" ? "selected" : ""} ${selectedAction && selectedAction !== "deny" ? "unselected" : ""}`}
          onClick={() => handleClick("deny")}
        >
          No
        </button>
      </div>
    </div>
  );
}
