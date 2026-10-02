import DOMPurify from "dompurify";
import { Marked } from "marked";
import morphdom from "morphdom";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { highlight, warmup } from "../services/highlighter";
import { useSettingsStore } from "../stores/settings-store";
import { LOOPBACK_LINK_NOTE, rewriteLoopbackHref } from "../utils/loopback-url";
import MermaidBlock from "./MermaidBlock";

// Pre-warm shiki on module load
warmup();

const marked = new Marked({
  gfm: true,
  breaks: true,
});

type MarkdownRendererProps = {
  content: string;
};

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    if (!containerRef.current) return;
    renderMarkdownToDOM(containerRef.current, content, theme);
  }, [content, theme]);

  return <div ref={containerRef} className="md-renderer" />;
}

function renderMarkdownToDOM(container: HTMLElement, content: string, theme: string) {
  const raw = marked.parse(content);
  if (typeof raw !== "string") return;

  // Sanitize HTML to prevent XSS before inserting into DOM
  const html = DOMPurify.sanitize(raw);

  // Use morphdom to preserve enhanced elements (shiki, mermaid)
  const next = document.createElement("div");
  next.className = "md-content";
  next.innerHTML = html;
  rewriteLoopbackLinks(next);

  if (container.firstElementChild) {
    morphdom(container.firstElementChild, next, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl.classList.contains("shiki")) return false;
        if (fromEl.isEqualNode(toEl)) return false;
        return true;
      },
    });
  } else {
    container.appendChild(next);
  }

  enhanceCodeBlocks(container, theme);
  renderMermaidBlocks(container);
}

function rewriteLoopbackLinks(root: HTMLElement): void {
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    const href = rewriteLoopbackHref(a.getAttribute("href") ?? "", window.location.hostname);
    if (href === null) continue;
    a.setAttribute("href", href);
    a.setAttribute("title", LOOPBACK_LINK_NOTE);
    a.classList.add("md-link--loopback");
  }
}

async function enhanceCodeBlocks(container: HTMLElement, theme: string): Promise<void> {
  const codeBlocks = Array.from(container.querySelectorAll("pre code"));

  for (const codeEl of codeBlocks) {
    const pre = codeEl.parentElement;
    if (!(pre instanceof HTMLElement) || pre.dataset.highlighted === "true") continue;

    // Extract language from class="language-xxx"
    const classes = Array.from(codeEl.classList) as string[];
    const langClass = classes.find((c) => c.startsWith("language-"));
    const lang = langClass?.replace("language-", "") || "";

    // Skip mermaid blocks (handled separately)
    if (lang === "mermaid") continue;
    if (!lang) continue;

    const code = codeEl.textContent || "";
    const highlighted = await highlight(code, lang, theme);

    if (highlighted && pre.parentElement) {
      pre.dataset.highlighted = "true";
      const wrapper = document.createElement("div");
      wrapper.className = "shiki-wrapper";
      wrapper.innerHTML = DOMPurify.sanitize(highlighted);
      pre.parentElement.replaceChild(wrapper, pre);
    }
  }
}

function renderMermaidBlocks(container: HTMLElement): void {
  const mermaidCodes = Array.from(container.querySelectorAll("code.language-mermaid"));

  for (const codeEl of mermaidCodes) {
    const pre = codeEl.parentElement;
    if (!(pre instanceof HTMLElement) || pre.dataset.mermaid === "true") continue;

    const code = codeEl.textContent || "";
    pre.dataset.mermaid = "true";

    // Replace <pre> with a mount point for MermaidBlock
    const mountPoint = document.createElement("div");
    mountPoint.className = "mermaid-mount";
    pre.parentElement?.replaceChild(mountPoint, pre);

    const root = createRoot(mountPoint);
    root.render(<MermaidBlock code={code} />);
  }
}
