import { hapticService } from "../services/haptic";
import { wsService } from "../services/ws-service";
import { useAppStore } from "../stores/app-store";
import DrawerBase from "./drawers/DrawerBase";

const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

interface ModelPickerProps {
  onClose: () => void;
}

export default function ModelPicker({ onClose }: ModelPickerProps) {
  const capabilities = useAppStore((s) => s.capabilities);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const selectedEffort = useAppStore((s) => s.selectedEffort);
  const activeSessionId = useAppStore((s) => s.activeSessionId);

  const models = capabilities?.models ?? [];
  const currentModelInfo = models.find((m) => m.value === selectedModel);

  const handleModelSelect = (modelValue: string) => {
    if (modelValue === selectedModel) return;
    hapticService.tap();
    wsService.setModel(modelValue, activeSessionId ?? undefined);
  };

  const handleEffortSelect = (effort: string | null) => {
    hapticService.tap();
    wsService.setEffort(effort as "low" | "medium" | "high" | "max" | null);
  };

  return (
    <DrawerBase open={true} onOpenChange={(open) => !open && onClose()} title="Model & Effort">
      <div className="settings-body">
        <section className="settings-section">
          <h3>Model</h3>
          <div className="model-picker-list">
            {models.map((model) => (
              <button
                type="button"
                key={model.value}
                className={`model-picker-item ${selectedModel === model.value ? "active" : ""}`}
                onClick={() => handleModelSelect(model.value)}
              >
                <span className="model-picker-name">{model.displayName}</span>
                <span className="model-picker-desc">{model.description}</span>
                {model.supportsFastMode && <span className="model-picker-badge">Fast</span>}
              </button>
            ))}
            {models.length === 0 && (
              <p className="model-picker-empty">Send a message first to load available models</p>
            )}
          </div>
        </section>

        {currentModelInfo?.supportsEffort && currentModelInfo.supportedEffortLevels && (
          <section className="settings-section">
            <h3>Effort</h3>
            <div className="effort-picker">
              <button
                type="button"
                className={`effort-picker-btn ${selectedEffort === null ? "active" : ""}`}
                onClick={() => handleEffortSelect(null)}
              >
                Auto
              </button>
              {EFFORT_LEVELS.filter((e) => currentModelInfo.supportedEffortLevels?.includes(e)).map(
                (level) => (
                  <button
                    type="button"
                    key={level}
                    className={`effort-picker-btn ${selectedEffort === level ? "active" : ""}`}
                    onClick={() => handleEffortSelect(level)}
                  >
                    {level}
                  </button>
                ),
              )}
            </div>
          </section>
        )}
      </div>
    </DrawerBase>
  );
}
