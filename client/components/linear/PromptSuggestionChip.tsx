import { useAppStore } from "../../stores/app-store";
import "./prompt-suggestion-chip.css";

const MAX_LEN = 80;

function truncate(text: string): string {
  if (text.length <= MAX_LEN) return text;
  return `${text.slice(0, MAX_LEN - 1)}…`;
}

interface Props {
  sessionId: string;
}

/**
 * Tappable chip rendered above InputBar when the SDK predicts a likely
 * next prompt. Tap inserts the full suggestion into `inputDraft` and
 * clears the slot. The slot is also cleared on the next user send
 * (wired in `ws-service.send`).
 *
 * Empty strings are treated as null per the contract.
 */
export default function PromptSuggestionChip({ sessionId }: Props) {
  const suggestion = useAppStore((s) => s.sessions.get(sessionId)?.promptSuggestion ?? null);
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const setPromptSuggestion = useAppStore((s) => s.setPromptSuggestion);

  if (!suggestion) return null;

  const handleTap = () => {
    setInputDraft(suggestion);
    setPromptSuggestion(sessionId, null);
  };

  return (
    <button
      type="button"
      className="lin-prompt-suggestion-chip"
      onClick={handleTap}
      title={suggestion}
      data-testid="prompt-suggestion-chip"
    >
      <span className="lin-prompt-suggestion-chip-prefix">Try:</span>{" "}
      <span className="lin-prompt-suggestion-chip-text">{truncate(suggestion)}</span>
    </button>
  );
}
