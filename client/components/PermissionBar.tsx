import { AnimatePresence, motion } from "framer-motion";
import type { PendingPermission } from "../stores/app-store";
import { slideUp, springTransition } from "../utils/motion-variants";
import PermissionFooter from "./PermissionFooter";

type PermissionBarProps = {
  pending: PendingPermission | null;
  onApprove: () => void;
  onDeny: () => void;
  onAnswer?: (answers: Record<string, string>) => void;
};

export default function PermissionBar({
  pending,
  onApprove,
  onDeny,
  onAnswer,
}: PermissionBarProps) {
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
    <AnimatePresence>
      {pending && (
        <motion.div
          className="permission-bar"
          initial={slideUp.initial}
          animate={slideUp.animate}
          exit={slideUp.exit}
          transition={springTransition}
        >
          <PermissionFooter
            toolName={pending.tool.name}
            parameters={pending.tool.parameters}
            onRespond={handleRespond}
            onAnswer={onAnswer}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
