import DOMPurify from "dompurify";

type PreviewRendererProps = {
  html: string;
};

export default function PreviewRenderer({ html }: PreviewRendererProps) {
  if (!html.trim()) {
    return <div className="preview-unavailable">(Preview unavailable)</div>;
  }

  const sanitized = DOMPurify.sanitize(html);

  return <div className="preview-content" dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
