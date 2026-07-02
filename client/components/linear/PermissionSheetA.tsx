import { useEffect, useRef, useState } from "react";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { hapticService } from "../../services/haptic";
import type { PendingPermission } from "../../stores/app-store";

const TIMEOUT_SECONDS = 60;
const SWIPE_THRESHOLD_PX = 80;

interface Props {
  pending: PendingPermission | null;
  onApprove: () => void;
  onDeny: () => void;
}

function targetOf(p: PendingPermission): { target: string; line?: number } {
  const params = p.tool.parameters;
  if (typeof params.file_path === "string") {
    const line = typeof params.line === "number" ? (params.line as number) : undefined;
    return { target: params.file_path as string, line };
  }
  if (typeof params.path === "string") return { target: params.path as string };
  if (typeof params.command === "string")
    return { target: (params.command as string).split("\n")[0] };
  if (typeof params.url === "string") return { target: params.url as string };
  return { target: p.tool.name };
}

export default function PermissionSheetA({ pending, onApprove, onDeny }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SECONDS);
  const [dragX, setDragX] = useState(0);
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
  const { target, line } = targetOf(pending);

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
      <div className="lin-permission-target">
        {target}
        {typeof line === "number" && <span className="lin-permission-line">:{line}</span>}
      </div>
      <div className="lin-permission-hint">
        <Icon name="swipe" size={11} color={T.fg3} />
        <span>swipe right to approve, left to deny</span>
      </div>
      <div className="lin-permission-actions">
        <button type="button" className="lin-permission-deny" onClick={onDeny}>
          Deny
        </button>
        <button type="button" className="lin-permission-approve" onClick={onApprove}>
          Approve
        </button>
      </div>
    </div>
  );
}
