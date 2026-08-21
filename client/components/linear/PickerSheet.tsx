import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import DrawerBase from "../drawers/DrawerBase";
import "./picker.css";

type PickerItem = {
  name: string;
  description?: string;
};

interface PickerSheetProps {
  kind: "slash" | "agent";
  items: PickerItem[];
  onSelect: (literal: string) => void;
  onClose: () => void;
  open: boolean;
  loading?: boolean;
  /**
   * Present only when the empty list is a probe that never answered, never
   * when it is an answer that happened to be empty. It is the one way out of
   * `unavailable`: the failure is cached server-side under (kind, cwd), so
   * without a re-probe that cwd stays empty until the server restarts.
   */
  onRetry?: () => void;
}

export default function PickerSheet({
  kind,
  items,
  onSelect,
  onClose,
  open,
  loading = false,
  onRetry,
}: PickerSheetProps) {
  const title = kind === "slash" ? "Commands" : "Agents";

  const handleSelect = (name: string) => {
    hapticService.tap();
    onSelect(kind === "slash" ? `/${name}` : `@${name}`);
    requestAnimationFrame(onClose);
  };

  return (
    <DrawerBase open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <div className="lin-picker">
        {loading ? (
          <div className="lin-picker-state">Loading…</div>
        ) : items.length === 0 ? (
          <div className="lin-picker-state">
            {kind === "slash" ? "No commands available." : "No agents available."}
            {onRetry && (
              <button
                type="button"
                className="lin-picker-retry"
                onClick={() => {
                  hapticService.tap();
                  onRetry();
                }}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="lin-picker-list">
            {items.map((item) => (
              <button
                key={`${kind}-${item.name}`}
                type="button"
                className="lin-settings-row lin-picker-row"
                onClick={() => handleSelect(item.name)}
              >
                <div className="lin-settings-row-main">
                  <div className="lin-settings-row-title">{item.name}</div>
                  {item.description && (
                    <div className="lin-settings-row-desc">{item.description}</div>
                  )}
                </div>
                <Icon name="chevronR" size={14} color={T.fg3} />
              </button>
            ))}
          </div>
        )}
      </div>
    </DrawerBase>
  );
}
