import { hapticService } from "../../services/haptic";
import { wsService } from "../../services/ws-service";
import { useAppStore } from "../../stores/app-store";
import { useSettingsStore } from "../../stores/settings-store";
import DrawerBase from "../drawers/DrawerBase";

interface Props {
  open: boolean;
  onClose: () => void;
}

// CLI model aliases — used until the device reports its own model list
// (capabilities.models is only populated after an SDK init message).
// Aliases resolve to the current model on the local claude CLI, so they
// never go stale with CLI updates.
export const FALLBACK_MODELS = [
  { value: "opus", displayName: "Opus", description: "Most capable" },
  { value: "sonnet", displayName: "Sonnet", description: "Balanced speed and intelligence" },
  { value: "haiku", displayName: "Haiku", description: "Fastest and most cost-effective" },
];

export default function ModelSheet({ open, onClose }: Props) {
  const selectedModel = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);
  const capabilities = useAppStore((s) => s.capabilities);
  const deviceModels = capabilities?.models ?? [];
  const models = deviceModels.length > 0 ? deviceModels : FALLBACK_MODELS;
  const activeModel = capabilities?.model;

  const handleSelect = (value: string) => {
    hapticService.tap();
    setModel(value);
    wsService.setModel(value);
    onClose();
  };

  const defaultSelected = selectedModel === "";

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && onClose()} title="Model">
      <div className="lin-settings-card">
        <button type="button" className="lin-settings-row" onClick={() => handleSelect("")}>
          <span className={`lin-radio ${defaultSelected ? "is-selected" : ""}`} aria-hidden>
            {defaultSelected && <span className="lin-radio-dot" />}
          </span>
          <div className="lin-settings-row-main">
            <div className="lin-settings-row-title">Device default</div>
            <div className="lin-settings-row-desc">
              Follow the model the local Claude CLI is configured to use
            </div>
          </div>
          {activeModel && <div className="lin-settings-row-value is-mono">{activeModel}</div>}
        </button>
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
