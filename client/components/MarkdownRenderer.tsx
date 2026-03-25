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
  isStreaming?: boolean;
};

// Minimum interval between renders during streaming (~30fps)
const STREAM_RENDER_INTERVAL = 32;

export default function MarkdownRenderer({ content, isStreaming }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(content);
  const lastRenderAt = useRef(0);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const theme = useSettingsStore((s) => s.theme);

  // Always keep contentRef up to date (read by trailing timer callback)
  contentRef.current = content;

  useEffect(() => {
    if (!containerRef.current) return;

    if (isStreaming) {
      const now = performance.now();
      const elapsed = now - lastRenderAt.current;

      if (elapsed >= STREAM_RENDER_INTERVAL) {
        // Leading edge: enough time passed, render immediately
        renderMarkdownToDOM(containerRef.current, content, theme, true);
        lastRenderAt.current = now;
        // Clear any pending trailing render
        if (trailingTimer.current) {
          clearTimeout(trailingTimer.current);
          trailingTimer.current = null;
        }
      } else {
        // Trailing edge: schedule render for remaining interval
        if (trailingTimer.current) clearTimeout(trailingTimer.current);
        trailingTimer.current = setTimeout(() => {
          trailingTimer.current = null;
          lastRenderAt.current = performance.now();
          if (containerRef.current) {
            renderMarkdownToDOM(containerRef.current, contentRef.current, theme, true);
          }
        }, STREAM_RENDER_INTERVAL - elapsed);
      }
    } else {
      // Not streaming: cancel pending timer and render immediately with full enhancements
      if (trailingTimer.current) {
        clearTimeout(trailingTimer.current);
        trailingTimer.current = null;
      }
      renderMarkdownToDOM(containerRef.current, content, theme, false);
      lastRenderAt.current = 0;
    }
  }, [content, theme, isStreaming]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (trailingTimer.current) clearTimeout(trailingTimer.current);
    },
    [],
  );

  return <div ref={containerRef} className="md-renderer" />;
}

function renderMarkdownToDOM(
  container: HTMLElement,
  content: string,
  theme: string,
  skipEnhancements: boolean,
) {
  const raw = marked.parse(content);
  if (typeof raw !== "string") return;

  // Sanitize HTML to prevent XSS before inserting into DOM
  const html = DOMPurify.sanitize(raw);

  if (skipEnhancements) {
    // Streaming fast path: set innerHTML directly, skip morphdom diffing.
    // No enhanced elements (shiki/mermaid) to preserve during streaming.
    let target = container.firstElementChild as HTMLElement | null;
    if (!target) {
      target = document.createElement("div");
      target.className = "md-content";
      container.appendChild(target);
    }
    target.innerHTML = html;
  } else {
    // Final render: use morphdom to preserve enhanced elements (shiki, mermaid)
    const next = document.createElement("div");
    next.className = "md-content";
    next.innerHTML = html;

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
