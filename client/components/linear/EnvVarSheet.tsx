import { useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { wsService } from "../../services/ws-service";
import { useSettingsStore } from "../../stores/settings-store";
import { validateEnvKey } from "../../utils/env-validation";
import DrawerBase from "../drawers/DrawerBase";
import "./env-var-sheet.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function EnvVarSheet({ open, onClose }: Props) {
  const envVars = useSettingsStore((s) => s.envVars);
  const setEnvVar = useSettingsStore((s) => s.setEnvVar);
  const removeEnvVar = useSettingsStore((s) => s.removeEnvVar);

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(envVars);

  const handleAdd = () => {
    setError(null);
    const validationError = validateEnvKey(newKey);
    if (validationError) {
      setError(validationError);
      return;
    }

    const next = { ...envVars, [newKey]: newValue };
    setEnvVar(newKey, newValue);
    wsService.setEnvVars(next);
    setNewKey("");
    setNewValue("");
  };

  const handleDelete = (key: string) => {
    removeEnvVar(key);
    const next = { ...envVars };
    delete next[key];
    wsService.setEnvVars(next);
  };

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && onClose()} title="Environment">
      <div className="lin-envvar-sheet">
        {entries.length > 0 && (
          <div className="lin-settings-card lin-envvar-list">
            {entries.map(([key, value]) => (
              <div key={key} className="lin-settings-row is-static">
                <div className="lin-settings-row-main">
                  <div className="lin-settings-row-title">{key}</div>
                  <div className="lin-settings-row-desc lin-envvar-value">{value}</div>
                </div>
                <button
                  type="button"
                  className="lin-icon-btn"
                  onClick={() => handleDelete(key)}
                  aria-label={`Delete ${key}`}
                >
                  <Icon name="close" size={14} color={T.fg2} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="lin-envvar-form">
          <input
            type="text"
            className="lin-envvar-input"
            placeholder="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
          <input
            type="text"
            className="lin-envvar-input"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <button type="button" className="lin-send-btn" onClick={handleAdd} aria-label="Add">
            <Icon name="plus" size={14} color={T.bg} />
          </button>
        </div>

        {error && <div className="lin-envvar-error">{error}</div>}
      </div>
    </DrawerBase>
  );
}
