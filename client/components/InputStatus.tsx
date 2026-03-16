import type { UsageData } from "../stores/app-store";

type InputStatusProps = {
  connected: boolean;
  usage: UsageData | null;
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function InputStatus({ connected, usage }: InputStatusProps) {
  if (!connected) {
    return (
      <div className="input-status">
        <span className="input-status-dot disconnected" />
        <span className="input-status-text">Disconnected</span>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="input-status">
        <span className="input-status-dot connected" />
        <span className="input-status-text">Connected</span>
      </div>
    );
  }

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const cost = usage.totalCost.toFixed(2);

  return (
    <div className="input-status">
      <span className="input-status-dot connected" />
      <span className="input-status-text">${cost}</span>
      <span className="input-status-separator">•</span>
      <span className="input-status-text">{formatTokens(totalTokens)} tokens</span>
      <span className="input-status-separator">•</span>
      <span className="input-status-text">{usage.turns} turns</span>
    </div>
  );
}
