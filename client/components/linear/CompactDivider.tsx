import "./compact-divider.css";

interface Props {
  preTokens?: number;
  postTokens?: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export default function CompactDivider({ preTokens, postTokens }: Props) {
  const hasFigures = typeof preTokens === "number";
  return (
    <div className="lin-compact-divider" role="separator" aria-label="History compacted">
      <span className="lin-compact-divider-line" />
      <span className="lin-compact-divider-label">
        {hasFigures ? (
          <>
            history compacted · {formatTokens(preTokens ?? 0)}
            {typeof postTokens === "number" ? ` → ${formatTokens(postTokens)} tokens` : " tokens"}
          </>
        ) : (
          <>history compacted</>
        )}
      </span>
      <span className="lin-compact-divider-line" />
    </div>
  );
}
