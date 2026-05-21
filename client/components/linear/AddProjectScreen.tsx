import { useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { saveProject } from "../../services/projects";
import { toastService } from "../../services/toast-service";
import FolderPicker from "../FolderPicker";
import "./projects.css";

interface Props {
  onSaved: (cwd: string) => void;
  onCancel: () => void;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export default function AddProjectScreen({ onSaved, onCancel }: Props) {
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const trimmedPath = path.trim();
  const canSave = trimmedPath.length > 0 && trimmedPath.startsWith("/");

  const handlePickerSelect = (selected: string) => {
    setPath(selected);
    if (!label) setLabel(basename(selected));
    setPickerOpen(false);
  };

  const handleSave = () => {
    if (!canSave) return;
    saveProject(trimmedPath, label.trim() || undefined);
    toastService.success("Project added");
    onSaved(trimmedPath);
  };

  return (
    <div className="lin-projects">
      <header className="lin-projects-header">
        <button
          type="button"
          className="lin-btn lin-sessions-icon-btn"
          onClick={onCancel}
          aria-label="Cancel"
        >
          <Icon name="chevronL" size={18} color={T.fg2} />
        </button>
        <div className="lin-projects-title">Add Project</div>
      </header>

      <div className="lin-addproject-body lin-scroll">
        <div className="lin-field">
          <label className="lin-field-label" htmlFor="ap-path">
            Folder Path
          </label>
          <div className="lin-field-row">
            <input
              id="ap-path"
              className="lin-input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/you/workspace/my-project"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="button" className="lin-input-button" onClick={() => setPickerOpen(true)}>
              Browse…
            </button>
          </div>
          <div className="lin-field-hint">
            Absolute path. Must be inside an allowed root if configured.
          </div>
        </div>

        <div className="lin-field">
          <label className="lin-field-label" htmlFor="ap-label">
            Label (optional)
          </label>
          <input
            id="ap-label"
            className="lin-input is-sans"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={trimmedPath ? basename(trimmedPath) : "Display name"}
          />
          <div className="lin-field-hint">Defaults to folder name. Used in the projects list.</div>
        </div>
      </div>

      <footer className="lin-addproject-footer">
        <button type="button" className="lin-addproject-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="lin-addproject-save"
          disabled={!canSave}
          onClick={handleSave}
        >
          Save
        </button>
      </footer>

      <FolderPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
      />
    </div>
  );
}
