import DOMPurify from "dompurify";
import { Marked } from "marked";
import morphdom from "morphdom";
import { useEffect, useRef } from "react";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

type MarkdownRendererProps = {
  content: string;
};

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
          // Skip unchanged nodes for performance
          if (fromEl.isEqualNode(toEl)) return false;
          return true;
        },
      });
    } else {
      containerRef.current.appendChild(next);
    }
  }, [content]);

  return <div ref={containerRef} className="md-renderer" />;
}
