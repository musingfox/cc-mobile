import { Pin, PinOff, Slash } from "lucide-react";
import { useEffect, useState } from "react";
import { loadPins, savePins, togglePin } from "../../services/pins";
import type { CommandInfo } from "../../stores/app-store";
import { useAppStore } from "../../stores/app-store";
import IconButton from "./IconButton";
import ScreenHeader from "./ScreenHeader";

interface CommandsScreenProps {
  variant: "screen" | "sheet";
  onSelect?: (commandName: string) => void;
  onClose?: () => void;
}

function filterCommands(commands: CommandInfo[], query: string): CommandInfo[] {
  if (!query) return commands;
  const lowerQuery = query.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(lowerQuery) ||
      cmd.description?.toLowerCase().includes(lowerQuery),
  );
}

function CommandRow({
  command,
  matched,
  isPinned,
  onTogglePin,
  onClick,
}: {
  command: CommandInfo;
  matched: boolean;
  isPinned: boolean;
  onTogglePin: () => void;
  onClick: () => void;
}) {
  return (
    <div className={`ember-command-row ${matched ? "ember-command-row--matched" : ""}`}>
      <button
        type="button"
        className="ember-command-row-content"
        onClick={onClick}
        aria-label={`Insert command ${command.name}`}
      >
        <span className={`ember-command-name ${matched ? "ember-command-name--matched" : ""}`}>
          {command.name}
        </span>
        <span className="ember-command-description">{command.description || "No description"}</span>
        {command.category && <span className="ember-category-pill">{command.category}</span>}
        {matched && <span className="ember-matched-pill">↵</span>}
      </button>
      <IconButton
        icon={isPinned ? <PinOff size={14} /> : <Pin size={14} />}
        onClick={onTogglePin}
        label={isPinned ? "Unpin command" : "Pin command"}
        variant="ghost"
        size={24}
      />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="ember-commands-list">
      {[1, 2, 3].map((i) => (
        <div key={i} className="ember-skeleton ember-command-row-skeleton" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="ember-commands-empty">
      <p>No commands available.</p>
    </div>
  );
}

export default function CommandsScreen({ variant, onSelect }: CommandsScreenProps) {
  const capabilities = useAppStore((s) => s.capabilities);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedCommands, setPinnedCommands] = useState<string[]>([]);

  useEffect(() => {
    setPinnedCommands(loadPins());
  }, []);

  const commands = capabilities?.commands ?? [];
  const filteredCommands = filterCommands(commands, searchQuery);
  const matchCount = filteredCommands.length;

  const handleTogglePin = (commandName: string) => {
    const newPins = togglePin({ item: commandName, currentPins: pinnedCommands });
    setPinnedCommands(newPins);
    savePins(newPins);
  };

  const content = (
    <>
      <div className="ember-search-input-container ember-search-input-container--command">
        <Slash className="ember-command-search-icon" size={16} />
        <input
          type="text"
          className="ember-search-input ember-search-input--command"
          placeholder="Find a command…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <span className="ember-command-match-count">
            {matchCount} {matchCount === 1 ? "match" : "matches"}
          </span>
        )}
      </div>
      {capabilities === null ? (
        <LoadingSkeleton />
      ) : commands.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="ember-commands-list">
          {filteredCommands.map((command) => (
            <CommandRow
              key={command.name}
              command={command}
              matched={!!searchQuery}
              isPinned={pinnedCommands.includes(command.name)}
              onTogglePin={() => handleTogglePin(command.name)}
              onClick={() => onSelect?.(command.name)}
            />
          ))}
        </div>
      )}
    </>
  );

  if (variant === "screen") {
    const builtInCount = commands.length;
    return (
      <div className="ember-commands-screen">
        <ScreenHeader
          title="Commands"
          subtitle="Slash commands run inline in chat"
          rightSlot={<span className="ember-command-count">{builtInCount} built-in</span>}
        />
        <div className="ember-commands-screen-body">{content}</div>
      </div>
    );
  }

  // variant === "sheet"
  return <div className="ember-commands-sheet-body">{content}</div>;
}
