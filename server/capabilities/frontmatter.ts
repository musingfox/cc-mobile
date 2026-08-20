import { readFileSync } from "node:fs";

interface FrontmatterFields {
  description?: string;
  argumentHint?: string;
}

interface ReadFrontmatterInput {
  file: string;
  read?: (file: string) => string;
}

/** Reads the fields used to decorate a command or agent definition. */
export function readFrontmatter({
  file,
  read = (path) => readFileSync(path, "utf-8"),
}: ReadFrontmatterInput): FrontmatterFields | null {
  let text: string;
  try {
    text = read(file);
  } catch {
    return null;
  }

  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;

  const fields: FrontmatterFields = {};
  const lines = text.slice(4, end).split("\n");
  for (let index = 0; index < lines.length; index++) {
    const match = /^(description|argument-hint):\s*(.*)$/.exec(lines[index]);
    if (!match) continue;

    let value = match[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      const body: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        body.push(lines[++index].trim());
      }
      value = body.join(" ");
    } else if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (!value) continue;
    if (match[1] === "description") fields.description = value;
    else fields.argumentHint = value;
  }

  return fields.description || fields.argumentHint ? fields : null;
}
