import { loadPins } from "../../services/pins";
import { useAppStore } from "../../stores/app-store";
import "./quick-actions.css";

export default function QuickActions() {
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const pins = loadPins();

  const handlePinClick = (pin: string) => {
    setInputDraft(`/${pin} `);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>(".lin-composer-input");
      input?.focus();
      const end = input?.value.length ?? 0;
      input?.setSelectionRange(end, end);
    });
  };

  if (pins.length === 0) {
    return (
      <div className="lin-quick-actions-empty">
        Long-press a command in the picker to pin it. (Pinning coming soon.)
      </div>
    );
  }

  return (
    <div className="lin-quick-actions" aria-label="Quick actions">
      {pins.map((pin) => (
        <button
          type="button"
          key={pin}
          className="lin-quick-action-chip"
          onClick={() => handlePinClick(pin)}
        >
          /{pin}
        </button>
      ))}
    </div>
  );
}
