import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import "./rate-limit-chip.css";

const GATED_SUBSCRIPTIONS = new Set(["free", "pro", "max", "team", "enterprise"]);

/**
 * Format the time-until-reset window. Returns a short label like
 * "14m" or "2h". Caller is responsible for hiding the chip when the
 * window is in the past.
 */
function formatResetIn(resetsAt: number, now: number): string {
  const deltaMs = resetsAt - now;
  const totalMinutes = Math.max(0, Math.round(deltaMs / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.round(totalMinutes / 60);
  return `${hours}h`;
}

/**
 * Footer chip that surfaces the current rate-limit window. Renders
 * when:
 *   - `rateLimitInfo.status === "rejected"` (always — hard rejection
 *     is meaningful for any account type), OR
 *   - `accountInfo.subscriptionType` is a known consumer plan
 *     ({free,pro,max,team,enterprise}); API-key users see nothing
 *     except hard rejections.
 *
 * Self-refreshes every 30s so the countdown stays current without
 * needing a global ticker.
 */
export default function RateLimitChip() {
  const rateLimitInfo = useAppStore((s) => s.rateLimitInfo);
  const subscriptionType = useAppStore((s) => s.capabilities?.accountInfo?.subscriptionType);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  if (!rateLimitInfo) return null;

  const isRejected = rateLimitInfo.status === "rejected";
  const isGatedSubscription =
    typeof subscriptionType === "string" && GATED_SUBSCRIPTIONS.has(subscriptionType);

  if (!isRejected && !isGatedSubscription) return null;

  // Stale window: timestamp has passed but the slot wasn't cleared yet.
  if (typeof rateLimitInfo.resetsAt === "number" && rateLimitInfo.resetsAt <= now && !isRejected) {
    return null;
  }

  let text: string;
  let variant: "rejected" | "warning" | "neutral";
  if (isRejected) {
    text = "Quota exhausted";
    variant = "rejected";
  } else if (typeof rateLimitInfo.resetsAt === "number") {
    text = `Quota resets in ${formatResetIn(rateLimitInfo.resetsAt, now)}`;
    variant = "warning";
  } else {
    text = "Approaching quota";
    variant = "warning";
  }

  return (
    <div
      className={`lin-rate-limit-chip lin-rate-limit-chip--${variant}`}
      role="status"
      data-testid="rate-limit-chip"
    >
      {text}
    </div>
  );
}
