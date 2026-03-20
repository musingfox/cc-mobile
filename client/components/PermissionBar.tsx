import type { PendingPermission } from "../stores/app-store";
import PermissionFooter from "./PermissionFooter";

type PermissionBarProps = {
  pending: PendingPermission | null;
  onApprove: () => void;
  onDeny: () => void;
  onAnswer?: (answer: string) => void;
};

export default function PermissionBar({
  pending,
  onApprove,
  onDeny,
  onAnswer,
}: PermissionBarProps) {
  if (!pending) return null;

  const handleRespond = (action: "approve" | "approve_session" | "deny") => {
    if (action === "deny") {
      onDeny();
    } else {
      // For now, both "approve" and "approve_session" call onApprove
      // Full session-level allow is deferred
      onApprove();
    }
  };

  return (
    <div className="permission-bar">
      <PermissionFooter
        toolName={pending.tool.name}
        parameters={pending.tool.parameters}
        onRespond={handleRespond}
        onAnswer={onAnswer}
      />
    </div>
  );
}
