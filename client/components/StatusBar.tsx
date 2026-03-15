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

export default function StatusBar() {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);

  const activeSession = activeSessionId
    ? sessions.get(activeSessionId)
    : undefined;

  const usage = activeSession?.usage;

  if (!usage) return null;

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const formattedCost = `$${usage.totalCost.toFixed(2)}`;
  const formattedTokens = formatTokens(totalTokens);

  return (
    <div className="usage-status-bar">
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
    </div>
  );
}
