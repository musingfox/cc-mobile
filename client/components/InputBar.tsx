import { useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { useAppStore, type Capabilities } from "../stores/app-store";

type InputBarProps = {
  onSend: (content: string) => void;
  disabled: boolean;
  capabilities: Capabilities | null;
  onOpenCommandPanel: () => void;
  onOpenAgentPanel: () => void;
};

export default function InputBar({ onSend, disabled, capabilities, onOpenCommandPanel, onOpenAgentPanel }: InputBarProps) {
  const value = useAppStore((s) => s.inputDraft);
  const setValue = useAppStore((s) => s.setInputDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  const suggestions = useMemo(() => {
    if (!capabilities || !value) return [];

    const trimmed = value.trimStart();
    if (trimmed.startsWith("/")) {
      const query = trimmed.slice(1).toLowerCase();
      return capabilities.commands
        .filter((c) => c.toLowerCase().includes(query))
        .map((c) => ({ label: `/${c}`, value: `/${c}`, type: "command" as const }));
    }
    if (trimmed.startsWith("@")) {
      const query = trimmed.slice(1).toLowerCase();
      return capabilities.agents
        .filter((a) => a.toLowerCase().includes(query))
        .map((a) => ({ label: `@${a}`, value: `@${a}`, type: "agent" as const }));
    }
    return [];
  }, [value, capabilities]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSelect = (item: { value: string }) => {
    setValue(item.value + " ");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-bar-container">
      {suggestions.length > 0 && (
        <div className="autocomplete-list">
          {suggestions.map((item) => (
            <button
              key={item.value}
              className={`autocomplete-item ${item.type}`}
              onClick={() => handleSelect(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="input-bar">
        <button
          className="input-bar-action-btn"
          onClick={onOpenCommandPanel}
          disabled={disabled || !capabilities}
          aria-label="Open command panel"
        >
          /
        </button>
        <button
          className="input-bar-action-btn"
          onClick={onOpenAgentPanel}
          disabled={disabled || !capabilities}
          aria-label="Open agent panel"
        >
          @
        </button>
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message, / for commands, @ for agents"
          disabled={disabled}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
