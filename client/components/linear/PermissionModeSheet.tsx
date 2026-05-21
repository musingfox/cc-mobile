import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import DrawerBase from "../drawers/DrawerBase";
import { PERMISSION_MODES } from "./SettingsScreen";

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

export default function PermissionModeSheet({ open, onClose, sessionId }: Props) {
  const globalMode = useSettingsStore((s) => s.permissionMode);
  const session = useAppStore((s) => s.sessions.get(sessionId));
  const setSessionPermissionMode = useAppStore((s) => s.setSessionPermissionMode);

  const effectiveMode = session?.permissionMode ?? globalMode;

  const handleSelect = (mode: string) => {
    hapticService.tap();
    wsService.setPermissionMode(mode, sessionId);
    setSessionPermissionMode(sessionId, mode);
    onClose();
  };

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && onClose()} title="Permission Mode">
      <div className="lin-settings-card">
        {PERMISSION_MODES.map((m) => {
          const selected = effectiveMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              className="lin-settings-row"
              onClick={() => handleSelect(m.id)}
            >
              <span className={`lin-radio ${selected ? "is-selected" : ""}`} aria-hidden>
                {selected && <span className="lin-radio-dot" />}
              </span>
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">{m.title}</div>
                <div className="lin-settings-row-desc">{m.desc}</div>
              </div>
            </button>
          );
        })}
      </div>
    </DrawerBase>
  );
}
