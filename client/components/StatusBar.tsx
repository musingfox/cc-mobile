import { useAppStore } from "../stores/app-store";

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }
  return count.toString();
}

function formatResetTime(resetsAt: number): string {
  const diffMs = resetsAt - Date.now();
  if (diffMs <= 0) return "soon";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours}h${remainMins}m` : `${hours}h`;
}

export default function StatusBar() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const rateLimitInfo = useAppStore((s) => s.rateLimitInfo);

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : undefined;
  const usage = activeSession?.usage;

  const showRateLimit = rateLimitInfo && rateLimitInfo.status !== "allowed";

  if (!usage && !showRateLimit) return null;

  const totalTokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const formattedCost = usage ? `$${usage.totalCost.toFixed(2)}` : "";
  const formattedTokens = usage ? formatTokens(totalTokens) : "";

  return (
    <div className="usage-status-bar">
      {usage && (
        <>
          <span className="usage-item">
            <span className="usage-label">Cost:</span>
            <span className="usage-value">{formattedCost}</span>
          </span>
          <span className="usage-item">
            <span className="usage-label">Tokens:</span>
            <span className="usage-value">{formattedTokens}</span>
          </span>
          <span className="usage-item">
            <span className="usage-label">Turns:</span>
            <span className="usage-value">{usage.turns}</span>
          </span>
        </>
      )}
      {showRateLimit && (
        <span
          className={`rate-limit-badge ${rateLimitInfo.status === "rejected" ? "rate-limit-rejected" : "rate-limit-warning"}`}
        >
          {rateLimitInfo.status === "rejected" ? (
            <>
              Rate limited
              {rateLimitInfo.resetsAt && (
                <span className="rate-limit-reset">
                  {" "}
                  · resets {formatResetTime(rateLimitInfo.resetsAt)}
                </span>
              )}
            </>
          ) : (
            <>
              {rateLimitInfo.utilization !== undefined
                ? `${Math.round(rateLimitInfo.utilization * 100)}% used`
                : "Near limit"}
              {rateLimitInfo.rateLimitType && (
                <span className="rate-limit-type">
                  {" "}
                  · {rateLimitInfo.rateLimitType.replace(/_/g, " ")}
                </span>
              )}
            </>
          )}
        </span>
      )}
    </div>
  );
}
