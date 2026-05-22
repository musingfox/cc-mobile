import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

type OptionButtonProps = {
  option: {
    label: string;
    description: string;
    preview?: string;
  };
  onSelect: () => void;
  selected?: boolean;
  multiSelect?: boolean;
};

export default function OptionButton({
  option,
  onSelect,
  selected,
  multiSelect,
}: OptionButtonProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasPreview = !!option.preview && option.preview.trim().length > 0;

  return (
    <div className={`option-button-container${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className="permission-btn lin-settings-row option-button"
        onClick={onSelect}
        aria-pressed={multiSelect ? !!selected : undefined}
      >
        {multiSelect && (
          <span className={`option-checkbox${selected ? " is-checked" : ""}`} aria-hidden="true" />
        )}
        <div className="lin-settings-row-main">
          <div className="option-label lin-settings-row-title">{option.label}</div>
          {option.description && (
            <div className="option-description lin-settings-row-desc">{option.description}</div>
          )}
        </div>
      </button>
      {hasPreview && (
        <button
          type="button"
          className="preview-toggle"
          onClick={() => setPreviewOpen((v) => !v)}
          aria-label={previewOpen ? "Hide preview" : "Show preview"}
        >
          {previewOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
      {hasPreview && previewOpen && (
        <div className="preview-panel">
          <MarkdownRenderer content={option.preview ?? ""} />
        </div>
      )}
    </div>
  );
}
