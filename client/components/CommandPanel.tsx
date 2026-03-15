import { useState, useMemo, useEffect } from "react";
import type { Capabilities } from "../stores/app-store";
import { filterAndSortItems } from "../utils/command-filter";
import { loadPins, savePins, togglePin } from "../services/pins";

type CommandPanelProps = {
  capabilities: Capabilities | null;
  disabled: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
};

export default function CommandPanel({
  capabilities,
  disabled,
  onSelect,
  onClose,
}: CommandPanelProps) {
  const [query, setQuery] = useState("");
  const [pinnedItems, setPinnedItems] = useState<string[]>([]);

  useEffect(() => {
    setPinnedItems(loadPins());
  }, []);

  const filteredItems = useMemo(() => {
    if (!capabilities) return [];

    return filterAndSortItems({
      query,
      commands: capabilities.commands,
      agents: capabilities.agents,
      pinnedItems,
    });
  }, [query, capabilities, pinnedItems]);

  const handleTogglePin = (item: string) => {
    const updated = togglePin({ item, currentPins: pinnedItems });
    setPinnedItems(updated);
    savePins(updated);
  };

  const handleSelect = (value: string) => {
    if (disabled) return;
    onSelect(value);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="command-panel-overlay" onClick={handleBackdropClick}>
      <div className="command-panel">
        <div className="command-panel-header">
          <input
            type="text"
            className="command-panel-search"
            placeholder="Search commands and agents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            className="command-panel-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="command-panel-list">
          {!capabilities ? (
            <div className="command-panel-loading">Loading commands...</div>
          ) : filteredItems.length === 0 ? (
            <div className="command-panel-empty">No results found</div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.value}
                className={`command-panel-item ${item.pinned ? "pinned" : ""}`}
                onClick={() => handleSelect(item.value)}
              >
                <span className={`type-badge ${item.type}`}>
                  {item.type === "command" ? "CMD" : "AGT"}
                </span>
                <span className="command-panel-label">{item.label}</span>
                <button
                  className="command-panel-pin-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTogglePin(item.value);
                  }}
                  aria-label={item.pinned ? "Unpin" : "Pin"}
                >
                  {item.pinned ? "★" : "☆"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
