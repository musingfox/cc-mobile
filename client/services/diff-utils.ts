export type DiffLine = {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
  highlights?: Array<{ start: number; end: number }>;
};

/**
 * Computes a unified diff between two strings with inline character highlights.
 * @param oldStr - Original string
 * @param newStr - New string
 * @returns Array of diff lines with type, content, line numbers, and inline highlights
 */
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr ? oldStr.split("\n") : [];
  const newLines = newStr ? newStr.split("\n") : [];

  // Handle edge cases
  if (oldLines.length === 0 && newLines.length === 0) {
    return [];
  }

  if (oldLines.length === 0) {
    // New file: all lines are additions
    return newLines.map((line, idx) => ({
      type: "add" as const,
      content: line,
      newLineNum: idx + 1,
    }));
  }

  if (newLines.length === 0) {
    // File deletion: all lines are removals
    return oldLines.map((line, idx) => ({
      type: "remove" as const,
      content: line,
      oldLineNum: idx + 1,
    }));
  }

  // Use Myers diff algorithm (simplified LCS-based implementation)
  const diff = myersDiff(oldLines, newLines);
  return diff;
}

/**
 * Simplified Myers diff algorithm using LCS (Longest Common Subsequence).
 */
function myersDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const lcs = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let oldLineNum = 1;
  let newLineNum = 1;

  // First pass: create diff lines
  for (const [type, line] of lcs) {
    if (type === "context") {
      result.push({
        type: "context",
        content: line,
        oldLineNum: oldLineNum++,
        newLineNum: newLineNum++,
      });
    } else if (type === "remove") {
      result.push({
        type: "remove",
        content: line,
        oldLineNum: oldLineNum++,
      });
    } else if (type === "add") {
      result.push({
        type: "add",
        content: line,
        newLineNum: newLineNum++,
      });
    }
  }

  // Second pass: compute character highlights for adjacent remove/add pairs
  for (let i = 0; i < result.length; i++) {
    if (result[i].type === "remove") {
      // Look for adjacent add line
      if (i + 1 < result.length && result[i + 1].type === "add") {
        const removeLine = result[i];
        const addLine = result[i + 1];

        if (areSimilar(removeLine.content, addLine.content)) {
          removeLine.highlights = computeCharHighlights(removeLine.content, addLine.content);
          addLine.highlights = computeCharHighlights(addLine.content, removeLine.content);
        }
      }
    }
  }

  return result;
}

/**
 * Compute LCS (Longest Common Subsequence) and return diff operations.
 */
function computeLCS(
  oldLines: string[],
  newLines: string[],
): Array<["context" | "remove" | "add", string]> {
  const m = oldLines.length;
  const n = newLines.length;

  // DP table for LCS length
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result: Array<["context" | "remove" | "add", string]> = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift(["context", oldLines[i - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift(["add", newLines[j - 1]]);
      j--;
    } else if (i > 0) {
      result.unshift(["remove", oldLines[i - 1]]);
      i--;
    }
  }

  return result;
}

/**
 * Check if two lines are similar enough to compute character-level diff.
 */
function areSimilar(line1: string, line2: string): boolean {
  // Simple heuristic: lines are similar if they share at least 30% of characters
  const shorter = Math.min(line1.length, line2.length);
  const longer = Math.max(line1.length, line2.length);

  if (longer === 0) return true;
  if (shorter / longer < 0.3) return false;

  // Count common characters
  const set1 = new Set(line1);
  const set2 = new Set(line2);
  const intersection = [...set1].filter((c) => set2.has(c)).length;

  return intersection / Math.max(set1.size, set2.size) >= 0.3;
}

/**
 * Compute character-level highlights between two similar lines.
 */
function computeCharHighlights(
  line: string,
  otherLine: string,
): Array<{ start: number; end: number }> {
  const highlights: Array<{ start: number; end: number }> = [];
  let start = -1;

  for (let i = 0; i < Math.max(line.length, otherLine.length); i++) {
    const isDifferent = line[i] !== otherLine[i];

    if (isDifferent && start === -1) {
      start = i;
    } else if (!isDifferent && start !== -1) {
      highlights.push({ start, end: i });
      start = -1;
    }
  }

  // Close any open highlight
  if (start !== -1) {
    highlights.push({ start, end: line.length });
  }

  return highlights;
}
