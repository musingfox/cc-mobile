type OptionButtonProps = {
  option: {
    label: string;
    description: string;
    preview?: string;
  };
  onSelect: () => void;
};

export default function OptionButton({ option, onSelect }: OptionButtonProps) {
  return (
    <button
      type="button"
      className="permission-btn lin-settings-row option-button"
      onClick={onSelect}
    >
      <div className="lin-settings-row-main">
        <div className="option-label lin-settings-row-title">{option.label}</div>
        {option.description && (
          <div className="option-description lin-settings-row-desc">{option.description}</div>
        )}
      </div>
    </button>
  );
}
