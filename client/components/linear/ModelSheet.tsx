import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import DrawerBase from "../drawers/DrawerBase";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ModelSheet({ open, onClose }: Props) {
  const selectedModel = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);
  const capabilities = useAppStore((s) => s.capabilities);
  const models = capabilities?.models ?? [];

  const handleSelect = (value: string) => {
    hapticService.tap();
    setModel(value);
    wsService.setModel(value);
    onClose();
  };

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && onClose()} title="Model">
      <div className="lin-settings-card">
        {models.map((m) => {
          const selected = m.value === selectedModel;
          return (
            <button
              key={m.value}
              type="button"
              className="lin-settings-row"
              onClick={() => handleSelect(m.value)}
            >
              <span className={`lin-radio ${selected ? "is-selected" : ""}`} aria-hidden>
                {selected && <span className="lin-radio-dot" />}
              </span>
              <div className="lin-settings-row-main">
                <div className="lin-settings-row-title">{m.displayName}</div>
                {m.description && <div className="lin-settings-row-desc">{m.description}</div>}
              </div>
              <div className="lin-settings-row-value is-mono">{m.value}</div>
            </button>
          );
        })}
      </div>
    </DrawerBase>
  );
}
