import { ChevronDown, ChevronUp } from "lucide-react";
import PreviewRenderer from "./PreviewRenderer";

type OptionButtonProps = {
  option: {
    label: string;
    description: string;
    preview?: string;
  };
  expanded: boolean;
  onTogglePreview: () => void;
  onSelect: () => void;
};

export default function OptionButton({
  option,
  expanded,
  onTogglePreview,
  onSelect,
}: OptionButtonProps) {
  const hasPreview = Boolean(option.preview);

  return (
    <div className="option-button-container">
      <button type="button" className="permission-btn blue option-button" onClick={onSelect}>
        <div className="option-label">{option.label}</div>
        {option.description && <div className="option-description">{option.description}</div>}
      </button>
      {hasPreview && (
        <>
          <button
            type="button"
            className="preview-toggle"
            onClick={onTogglePreview}
            aria-label="Toggle preview"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {expanded && (
            <div className="preview-panel">
              <PreviewRenderer html={option.preview || ""} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
