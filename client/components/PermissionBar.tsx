import type { PendingPermission } from "../hooks/useSocket";

type PermissionBarProps = {
  pending: PendingPermission | null;
  onApprove: () => void;
  onDeny: () => void;
};

export default function PermissionBar({
  pending,
  onApprove,
  onDeny,
}: PermissionBarProps) {
  if (!pending) return null;

  const formatParams = (params: Record<string, unknown>) => {
    const entries = Object.entries(params);
    if (entries.length === 0) return "No parameters";

    return entries
      .map(([key, value]) => {
        const strValue =
          typeof value === "string"
            ? value
            : JSON.stringify(value);
        return `${key}: ${strValue.slice(0, 50)}${strValue.length > 50 ? "..." : ""}`;
      })
      .join(", ");
  };

  return (
    <div className="permission-bar">
      <div className="permission-info">
        <div className="permission-tool-name">{pending.tool.name}</div>
        <div className="permission-params">
          {formatParams(pending.tool.parameters)}
        </div>
      </div>
      <div className="permission-actions">
        <button className="permission-btn deny" onClick={onDeny}>
          Deny
        </button>
        <button className="permission-btn approve" onClick={onApprove}>
          Approve
        </button>
      </div>
    </div>
  );
}
