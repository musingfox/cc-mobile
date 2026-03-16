import { computeDiff, type DiffLine } from "../services/diff-utils";

type DiffViewProps = {
  oldString: string;
  newString: string;
  filePath?: string;
  collapsed: boolean;
  onToggle: () => void;
};

export default function DiffView({
  oldString,
  newString,
  filePath,
  collapsed,
  onToggle,
}: DiffViewProps) {
  const diffLines = computeDiff(oldString, newString);

  // Calculate stats
  const additions = diffLines.filter((line) => line.type === "add").length;
  const removals = diffLines.filter((line) => line.type === "remove").length;

  if (collapsed) {
    return (
      <div className="diff-view">
        <button type="button" className="diff-view-header collapsed" onClick={onToggle}>
          <span className="diff-view-expand-icon">▶</span>
          {filePath && <span className="diff-view-file-path">{filePath}</span>}
          <span className="diff-view-stats">
            <span className="diff-stat-add">+{additions}</span>
            <span className="diff-stat-remove">-{removals}</span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="diff-view">
      <button type="button" className="diff-view-header expanded" onClick={onToggle}>
        <span className="diff-view-expand-icon">▼</span>
        {filePath && <span className="diff-view-file-path">{filePath}</span>}
        <span className="diff-view-stats">
          <span className="diff-stat-add">+{additions}</span>
          <span className="diff-stat-remove">-{removals}</span>
        </span>
      </button>
      <div className="diff-view-content">
        {diffLines.map((line, idx) => {
          const key = `${line.type}-${line.oldLineNum ?? "new"}-${line.newLineNum ?? "old"}-${idx}`;
          return <DiffLineView key={key} line={line} />;
        })}
      </div>
    </div>
  );
}

function DiffLineView({ line }: { line: DiffLine }) {
  const { type, content, oldLineNum, newLineNum, highlights } = line;

  // Render line content with highlights
  const renderContent = () => {
    if (!highlights || highlights.length === 0) {
      return <span>{visualizeSpaces(content)}</span>;
    }

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const { start, end } of highlights) {
      // Add non-highlighted part
      if (start > lastEnd) {
        parts.push(
          <span key={`text-${lastEnd}`}>{visualizeSpaces(content.slice(lastEnd, start))}</span>,
        );
      }

      // Add highlighted part
      parts.push(
        <span key={`highlight-${start}`} className="diff-highlight">
          {visualizeSpaces(content.slice(start, end))}
        </span>,
      );

      lastEnd = end;
    }

    // Add remaining content
    if (lastEnd < content.length) {
      parts.push(<span key={`text-${lastEnd}`}>{visualizeSpaces(content.slice(lastEnd))}</span>);
    }

    return <>{parts}</>;
  };

  return (
    <div className={`diff-line diff-line-${type}`}>
      <span className="diff-line-num old">{oldLineNum !== undefined ? oldLineNum : ""}</span>
      <span className="diff-line-num new">{newLineNum !== undefined ? newLineNum : ""}</span>
      <span className="diff-line-prefix">{getPrefixChar(type)}</span>
      <span className="diff-line-content">{renderContent()}</span>
    </div>
  );
}

/**
 * Visualize leading spaces as middledot characters.
 */
function visualizeSpaces(text: string): string {
  let leadingSpaces = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " ") {
      leadingSpaces++;
    } else {
      break;
    }
  }

  if (leadingSpaces === 0) return text;

  return "·".repeat(leadingSpaces) + text.slice(leadingSpaces);
}

function getPrefixChar(type: DiffLine["type"]): string {
  switch (type) {
    case "add":
      return "+";
    case "remove":
      return "-";
    case "context":
      return " ";
  }
}
