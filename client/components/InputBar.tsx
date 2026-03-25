import { Send } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { clearDraft, loadDraft, saveDraft } from "../services/draft-persistence";
import { hapticService } from "../services/haptic";
import { type Capabilities, useAppStore } from "../stores/app-store";
import FloatingAutocomplete from "./FloatingAutocomplete";

type InputBarProps = {
  onSend: (content: string) => void;
  disabled: boolean;
  capabilities: Capabilities | null;
  onOpenCommandPanel: () => void;
  onOpenAgentPanel: () => void;
  activeSessionId: string | null;
};

export default function InputBar({
  onSend,
  disabled,
  capabilities,
  onOpenCommandPanel,
  onOpenAgentPanel,
  activeSessionId,
}: InputBarProps) {
  const value = useAppStore((s) => s.inputDraft);
  const setValue = useAppStore((s) => s.setInputDraft);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const debounceTimerRef = useRef<number | null>(null);

  // Load draft when activeSessionId changes
  useEffect(() => {
    if (activeSessionId) {
      const draft = loadDraft(activeSessionId);
      setValue(draft);
    } else {
      setValue("");
    }
  }, [activeSessionId, setValue]);

  // Auto-save draft on typing with debounce
  useEffect(() => {
    if (!activeSessionId) return;

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveDraft(activeSessionId, value);
    }, 500) as unknown as number;

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, activeSessionId]);

  const resizeTextarea = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const prevSuggestionsLenRef = useRef(0);
  const suggestions = useMemo(() => {
    if (!capabilities || !value) return [];

    const trimmed = value.trimStart();
    if (trimmed.startsWith("/")) {
      const query = trimmed.slice(1).toLowerCase();
      return capabilities.commands
        .filter((c) => c.toLowerCase().includes(query))
        .map((c) => ({ label: `/${c}`, type: "command" as const }));
    }
    if (trimmed.startsWith("@")) {
      const query = trimmed.slice(1).toLowerCase();
      return capabilities.agents
        .filter((a) => a.toLowerCase().includes(query))
        .map((a) => ({ label: `@${a}`, type: "agent" as const }));
    }
    return [];
  }, [value, capabilities]);

  // Reset selected index when suggestions list changes
  if (suggestions.length !== prevSuggestionsLenRef.current) {
    prevSuggestionsLenRef.current = suggestions.length;
    setSelectedIndex(0);
  }

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    hapticService.tap();
    onSend(trimmed);
    setValue("");
    if (activeSessionId) {
      clearDraft(activeSessionId);
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleSelect = (label: string) => {
    setValue(`${label} `);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle autocomplete navigation
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        handleSelect(suggestions[selectedIndex].label);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Prompt suggestion from SDK
  const promptSuggestion = useAppStore((s) => {
    if (!activeSessionId) return null;
    return s.sessions.get(activeSessionId)?.promptSuggestion ?? null;
  });

  const handleSuggestionClick = () => {
    if (!promptSuggestion) return;
    hapticService.tap();
    onSend(promptSuggestion);
    if (activeSessionId) {
      useAppStore.getState().setPromptSuggestion(activeSessionId, null);
    }
  };

  // Clear suggestion when user starts typing
  useEffect(() => {
    if (value && promptSuggestion && activeSessionId) {
      useAppStore.getState().setPromptSuggestion(activeSessionId, null);
    }
  }, [value, promptSuggestion, activeSessionId]);

  return (
    <div className="input-bar-container">
      {promptSuggestion && !disabled && (
        <button type="button" className="prompt-suggestion-chip" onClick={handleSuggestionClick}>
          <span className="prompt-suggestion-label">Suggested:</span>
          <span className="prompt-suggestion-text">{promptSuggestion}</span>
        </button>
      )}
      <FloatingAutocomplete
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        onSelect={handleSelect}
        visible={suggestions.length > 0}
      />
      <div className="input-bar">
        <button
          type="button"
          className="input-bar-action-btn"
          onClick={onOpenCommandPanel}
          disabled={disabled || !capabilities}
          aria-label="Open command panel"
        >
          /
        </button>
        <button
          type="button"
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
          onChange={(e) => {
            setValue(e.target.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message, / for commands, @ for agents"
          disabled={disabled}
          rows={1}
        />
        <button
          type="button"
          className="send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
