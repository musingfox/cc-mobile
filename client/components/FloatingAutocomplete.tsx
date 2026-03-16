type FloatingAutocompleteSuggestion = {
  label: string;
  description?: string;
  type: "command" | "agent";
};

type FloatingAutocompleteProps = {
  suggestions: FloatingAutocompleteSuggestion[];
  selectedIndex: number;
  onSelect: (label: string) => void;
  visible: boolean;
};

export default function FloatingAutocomplete({
  suggestions,
  selectedIndex,
  onSelect,
  visible,
}: FloatingAutocompleteProps) {
  if (!visible || suggestions.length === 0) return null;

  return (
    <div className="floating-autocomplete">
      {suggestions.map((item, index) => (
        <button
          type="button"
          key={item.label}
          className={`floating-autocomplete-item ${item.type} ${
            index === selectedIndex ? "selected" : ""
          }`}
          onClick={() => onSelect(item.label)}
        >
          <span className="floating-autocomplete-label">{item.label}</span>
          {item.description && (
            <span className="floating-autocomplete-description">{item.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
