import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";

type MermaidBlockProps = {
  code: string;
};

let mermaidId = 0;

export default function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setError("Empty diagram");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
        });

        const id = `mermaid-${++mermaidId}`;
        const { svg } = await mermaid.render(id, code.trim());

        if (!cancelled && containerRef.current) {
          // SVG from mermaid is sanitized via DOMPurify before injection
          const sanitized = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            ADD_TAGS: ["foreignObject"],
          });
          containerRef.current.textContent = "";
          const wrapper = document.createElement("div");
          wrapper.innerHTML = sanitized;
          const svgEl = wrapper.firstElementChild;
          if (svgEl) {
            containerRef.current.appendChild(svgEl);
          }
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render diagram");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="mermaid-error">
        <span>Diagram error: {error}</span>
      </div>
    );
  }

  return <div ref={containerRef} className="mermaid-container" />;
}
