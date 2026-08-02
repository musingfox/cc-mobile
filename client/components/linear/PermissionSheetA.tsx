import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import type { PendingPermission } from "../../stores/app-store";

const TIMEOUT_SECONDS = 60;
const SWIPE_THRESHOLD_PX = 80;

/** What the sheet offers when the server could not parse the terminal's screen. */
const CANCEL_ONLY = [{ id: "cancel", label: "Cancel", keystroke: "esc" }];

interface Props {
  pending: PendingPermission | null;
  onApprove: () => void;
  onDeny: () => void;
  /** Answers with one of the terminal's own options; the server presses its key. */
  onChoose?: (optionId: string) => void;
}

/**
 * What the prompt is about, in the terminal's own words.
 *
 * Since #29 there are no structured tool arguments to key on: while claude is
 * blocked its transcript says nothing about the pending call, so `parameters`
 * carries text the server parsed off the screen (Decision H3). Anything that
 * used to branch on `file_path` / `command` / `url` had no input left.
 */
function targetOf(p: PendingPermission): string {
  const text = p.tool.parameters.text;
  if (typeof text === "string" && text.trim().length > 0) return text;
  return p.tool.name;
}

export default function PermissionSheetA({ pending, onApprove, onDeny, onChoose }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SECONDS);
  const [dragX, setDragX] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    setDragX(e.touches[0].clientX - touchStartX.current);
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null) return;
    const dx = dragX;
    touchStartX.current = null;
    setDragX(0);
    if (dx >= SWIPE_THRESHOLD_PX) {
      hapticService.tap();
      onApprove();
    } else if (dx <= -SWIPE_THRESHOLD_PX) {
      hapticService.tap();
      onDeny();
    }
  };

  useEffect(() => {
    if (!pending) return;
    setSecondsLeft(TIMEOUT_SECONDS);
    setDragX(0);
    setChosen(null);
    touchStartX.current = null;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const left = Math.max(0, TIMEOUT_SECONDS - elapsed);
      setSecondsLeft(left);
    }, 500);
    return () => clearInterval(interval);
  }, [pending?.requestId]);

  if (!pending) return null;
  const description = pending.tool.parameters.description;
  // Never an empty sheet: an unparseable screen still gets a way out.
  const options = pending.options?.length ? pending.options : CANCEL_ONLY;

  const choose = (optionId: string) => {
    if (chosen) return;
    setChosen(optionId);
    hapticService.tap();
    if (onChoose) onChoose(optionId);
    else if (optionId === "cancel") onDeny();
  };

  return (
    <div
      className="lin-permission"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={dragX !== 0 ? { transform: `translateX(${dragX}px)` } : undefined}
    >
      <div className="lin-permission-row">
        <Icon name="shield" size={14} color={T.accentWarn} />
        <span className="lin-permission-label">Permission Required</span>
        <span className="lin-permission-timer">{secondsLeft}s</span>
      </div>
      <div className="lin-permission-tool">{pending.tool.name}</div>
      <div className="lin-permission-target">{targetOf(pending)}</div>
      {typeof description === "string" && description.length > 0 && (
        <div className="lin-permission-description">{description}</div>
      )}
      <div className="lin-permission-hint">
        <Icon name="swipe" size={11} color={T.fg3} />
        <span>swipe right to approve, left to deny</span>
      </div>
      <div className="lin-permission-actions">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            // The terminal's own wording, verbatim — inventing labels that
            // differ from what the pane shows would be worse than showing its
            // own words.
            className={option.id === "cancel" ? "lin-permission-deny" : "lin-permission-option"}
            disabled={chosen !== null}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
