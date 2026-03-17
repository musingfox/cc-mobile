import { Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadPins, savePins, togglePin } from "../services/pins";
import type { Capabilities } from "../stores/app-store";
import { filterAndSortItems } from "../utils/command-filter";
import DrawerBase from "./drawers/DrawerBase";

type PickerPanelProps = {
  mode: "command" | "agent";
  capabilities: Capabilities | null;
  disabled: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
};

export default function PickerPanel({
  mode,
  capabilities,
  disabled,
  onSelect,
  onClose,
}: PickerPanelProps) {
  const [query, setQuery] = useState("");
  const [pinnedItems, setPinnedItems] = useState<string[]>([]);

  useEffect(() => {
    setPinnedItems(loadPins());
  }, []);

  const filteredItems = useMemo(() => {
    if (!capabilities) return [];

    const allItems = filterAndSortItems({
      query,
      commands: capabilities.commands,
      agents: capabilities.agents,
      pinnedItems,
    });

    // Filter by mode
    return allItems.filter((item) => item.type === mode);
  }, [query, capabilities, pinnedItems, mode]);

  const handleTogglePin = (item: string) => {
    const updated = togglePin({ item, currentPins: pinnedItems });
    setPinnedItems(updated);
    savePins(updated);
  };

  const handleSelect = (value: string) => {
    if (disabled) return;
    onSelect(value);
  };

  const placeholder = mode === "command" ? "Search commands..." : "Search agents...";

  return (
    <DrawerBase
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="command-panel-header">
        <input
          type="text"
          className="command-panel-search"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="command-panel-list">
        {!capabilities ? (
          <div className="command-panel-loading">Loading...</div>
        ) : filteredItems.length === 0 ? (
          <div className="command-panel-empty">No results found</div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.value}
              role="option"
              tabIndex={0}
              className={`command-panel-item ${item.pinned ? "pinned" : ""}`}
              onClick={() => handleSelect(item.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleSelect(item.value);
              }}
            >
              <span className={`type-badge ${item.type}`}>
                {item.type === "command" ? "CMD" : "AGT"}
              </span>
              <span className="command-panel-label">{item.label}</span>
              <button
                type="button"
                className="command-panel-pin-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePin(item.value);
                }}
                aria-label={item.pinned ? "Unpin" : "Pin"}
              >
                {item.pinned ? <Star size={16} fill="currentColor" /> : <Star size={16} />}
              </button>
            </div>
          ))
        )}
      </div>
    </DrawerBase>
  );
}
