import DOMPurify from "dompurify";
import { Marked } from "marked";
import morphdom from "morphdom";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { highlight, warmup } from "../services/highlighter";
import { useSettingsStore } from "../stores/settings-store";
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

    const raw = marked.parse(content);
    if (typeof raw !== "string") return;

    const html = DOMPurify.sanitize(raw);

    // Create a temporary element with the sanitized HTML
    const next = document.createElement("div");
    next.className = "md-content";
    next.innerHTML = html;

    // Use morphdom to diff-patch the DOM (streaming-friendly, no flashing)
    if (containerRef.current.firstElementChild) {
      morphdom(containerRef.current.firstElementChild, next, {
        onBeforeElUpdated(fromEl, toEl) {
          // Preserve shiki-highlighted code blocks
          if (fromEl.classList.contains("shiki")) return false;
          if (fromEl.isEqualNode(toEl)) return false;
          return true;
        },
      });
    } else {
      containerRef.current.appendChild(next);
    }

    // Async-enhance code blocks with shiki (skip mermaid blocks)
    enhanceCodeBlocks(containerRef.current, theme);

    // Render mermaid diagrams
    renderMermaidBlocks(containerRef.current);
  }, [content, theme]);

  return <div ref={containerRef} className="md-renderer" />;
}

async function enhanceCodeBlocks(container: HTMLElement, theme: string): Promise<void> {
  const codeBlocks = container.querySelectorAll("pre code");

  for (const codeEl of codeBlocks) {
    const pre = codeEl.parentElement;
    if (!pre || pre.dataset.highlighted === "true") continue;

    // Extract language from class="language-xxx"
    const langClass = Array.from(codeEl.classList).find((c) => c.startsWith("language-"));
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
  const mermaidCodes = container.querySelectorAll("code.language-mermaid");

  for (const codeEl of mermaidCodes) {
    const pre = codeEl.parentElement;
    if (!pre || pre.dataset.mermaid === "true") continue;

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
