import type { Highlighter } from "shiki";

let highlighter: Highlighter | null = null;
let initPromise: Promise<Highlighter> | null = null;

// Map short aliases
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
};

function resolveLang(lang: string): string {
  return LANG_ALIASES[lang] || lang;
}

async function initHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Use bundled shiki which includes common languages + Vite-friendly
    const { createHighlighter } = await import("shiki");
    const h = await createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "javascript",
        "typescript",
        "json",
        "bash",
        "html",
        "css",
        "python",
        "jsx",
        "tsx",
        "yaml",
        "markdown",
        "sql",
        "rust",
        "go",
      ],
    });
    highlighter = h;
    return h;
  })();

  return initPromise;
}

export async function highlight(code: string, lang: string, theme: string): Promise<string> {
  try {
    const h = await initHighlighter();
    const resolved = resolveLang(lang);

    // Check if language is loaded
    const loadedLangs = h.getLoadedLanguages();
    if (!loadedLangs.includes(resolved)) {
      try {
        await h.loadLanguage(resolved as Parameters<typeof h.loadLanguage>[0]);
      } catch {
        return "";
      }
    }

    const shikiTheme = theme === "light" ? "github-light" : "github-dark";
    return h.codeToHtml(code, { lang: resolved, theme: shikiTheme });
  } catch {
    return "";
  }
}

// Pre-warm the highlighter
export function warmup(): void {
  initHighlighter();
}
