import { Plus, X } from "lucide-react";
import { useState } from "react";
import { wsService } from "../services/ws-service";
import { useSettingsStore } from "../stores/settings-store";
import { validateEnvKey } from "../utils/env-validation";

export default function EnvVarEditor() {
  const envVars = useSettingsStore((s) => s.envVars);
  const setEnvVar = useSettingsStore((s) => s.setEnvVar);
  const removeEnvVar = useSettingsStore((s) => s.removeEnvVar);

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    setError(null);
    const validationError = validateEnvKey(newKey);
    if (validationError) {
      setError(validationError);
      return;
    }

    setEnvVar(newKey, newValue);
    wsService.setEnvVars({ ...envVars, [newKey]: newValue });
    setNewKey("");
    setNewValue("");
  };

  const handleDelete = (key: string) => {
    removeEnvVar(key);
    const updated = { ...envVars };
    delete updated[key];
    wsService.setEnvVars(updated);
  };

  const entries = Object.entries(envVars);

  return (
    <div className="env-var-editor">
      {entries.length > 0 && (
        <div className="env-var-list">
          {entries.map(([key, value]) => (
            <div key={key} className="env-var-item">
              <div className="env-var-item-content">
                <span className="env-var-key">{key}</span>
                <span className="env-var-value">{value}</span>
              </div>
              <button
                type="button"
                className="env-var-delete"
                onClick={() => handleDelete(key)}
                aria-label={`Delete ${key}`}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="env-var-form">
        <input
          type="text"
          className="env-var-input"
          placeholder="Key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          type="text"
          className="env-var-input"
          placeholder="Value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
        />
        <button type="button" className="env-var-add" onClick={handleAdd} aria-label="Add">
          <Plus size={20} />
        </button>
      </div>
      {error && <div className="env-var-error">{error}</div>}
    </div>
  );
}
