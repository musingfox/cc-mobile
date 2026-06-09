import type { ContextUsage } from "../../stores/app-store";
import "./context-usage-chip.css";

interface Props {
  contextUsage: ContextUsage | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function ContextUsageChip({ contextUsage }: Props) {
  if (!contextUsage) {
    return (
      <span className="lin-context-usage-chip is-loading" aria-label="Context usage unavailable">
        — / —
      </span>
    );
  }
  const isWarning = contextUsage.percentage >= 0.8;
  const cls = isWarning ? "lin-context-usage-chip is-warning" : "lin-context-usage-chip";
  return (
    <span className={cls} aria-label="Context usage">
      {formatTokens(contextUsage.totalTokens)} / {formatTokens(contextUsage.maxTokens)}
    </span>
  );
}
