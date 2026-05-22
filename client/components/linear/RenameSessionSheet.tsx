import { useEffect, useState } from "react";
import { toastService } from "../../services/toast-service";
import { wsService } from "../../services/ws-service";
import DrawerBase from "../drawers/DrawerBase";

interface Props {
  open: boolean;
  onClose: () => void;
  sdkSessionId: string;
  cwd: string;
  initialTitle: string;
}

export default function RenameSessionSheet({
  open,
  onClose,
  sdkSessionId,
  cwd,
  initialTitle,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);

  // Reset local state when the sheet opens for a different row (or re-opens).
  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setSaving(false);
    }
  }, [open, initialTitle]);

  const trimmed = title.trim();
  const initialTrimmed = initialTitle.trim();
  const disabled = saving || trimmed === "" || trimmed === initialTrimmed;

  const handleSave = async () => {
    if (disabled) return;
    setSaving(true);
    try {
      wsService.setSessionTitle(sdkSessionId, trimmed, cwd);
      wsService.listSessions(cwd);
      toastService.success("Session renamed");
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && onClose()} title="Rename session">
      <div className="lin-envvar-sheet">
        <div className="lin-envvar-form">
          <input
            type="text"
            className="lin-envvar-input"
            placeholder="Untitled"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
            aria-label="Session title"
          />
          <button
            type="button"
            className="lin-projects-cta"
            onClick={handleSave}
            disabled={disabled}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </DrawerBase>
  );
}
