import { useState } from "react";
import type { IconName } from "../../design/icons";
import { Icon } from "../../design/icons";
import { tokens as T } from "../../design/tokens";
import { computeDiff } from "../../services/diff-utils";

interface Props {
  toolName: string;
  input: Record<string, unknown>;
  result: string;
}

function iconFor(toolName: string): IconName {
  const t = toolName.toLowerCase();
  if (t === "read" || t === "file") return "file";
  if (t === "edit" || t === "write" || t === "multiedit") return "edit";
  if (t === "bash" || t === "shell") return "terminal";
  if (t === "grep" || t === "glob" || t === "search") return "search";
  if (t === "webfetch" || t === "websearch") return "search";
  if (t === "task" || t === "agent") return "sparkles";
  return "wrench";
}

function targetOf(toolName: string, input: Record<string, unknown>): string {
  const t = toolName.toLowerCase();
  if (typeof input.file_path === "string") return input.file_path as string;
  if (typeof input.path === "string") return input.path as string;
  if (typeof input.pattern === "string") return input.pattern as string;
  if (typeof input.command === "string") return (input.command as string).split("\n")[0];
  if (typeof input.url === "string") return input.url as string;
  if (typeof input.description === "string") return input.description as string;
  return t;
}

function diffOf(toolName: string, input: Record<string, unknown>) {
  const t = toolName.toLowerCase();
  if (t !== "edit" && t !== "write" && t !== "multiedit") return null;
  const oldStr = typeof input.old_string === "string" ? (input.old_string as string) : "";
  const newStr = typeof input.new_string === "string" ? (input.new_string as string) : "";
  if (!oldStr && !newStr) return null;
  try {
    return computeDiff(oldStr, newStr);
  } catch {
    return null;
  }
}

export default function ToolCardA({ toolName, input, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const diff = diffOf(toolName, input);
  const target = targetOf(toolName, input);

  return (
    <div className="lin-tool-card">
      <button
        type="button"
        className="lin-tool-card-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Icon name={iconFor(toolName)} size={13} color={T.fg2} />
        <span className="lin-tool-label">{toolName}</span>
        <span className="lin-tool-target" title={target}>
          {target}
        </span>
        <Icon name={expanded ? "chevronU" : "chevronD"} size={12} color={T.fg3} />
      </button>

      {expanded && (
        <div className="lin-tool-body">
          {diff ? (
            <div className="lin-tool-diff">
              {diff.map((line, idx) => {
                const cls =
                  line.type === "add"
                    ? "lin-diff-add"
                    : line.type === "remove"
                      ? "lin-diff-remove"
                      : "lin-diff-context";
                const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
                return (
                  <div key={idx} className={cls}>
                    <span className="lin-diff-prefix">{prefix}</span>
                    {line.content}
                  </div>
                );
              })}
            </div>
          ) : (
            <pre className="lin-tool-result">{result || "(no output)"}</pre>
          )}
        </div>
      )}
    </div>
  );
}
