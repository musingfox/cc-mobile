import "./permission-denied-marker.css";

interface Props {
  toolName: string;
  message: string;
}

/**
 * Greyed inline marker for non-interactive tool denials (mode/rule/classifier).
 * Visually distinct from tool-error rendering — class `lin-deny-marker`.
 */
export default function PermissionDeniedMarker({ toolName, message }: Props) {
  return (
    <div className="lin-deny-marker" role="note" aria-label="Permission denied">
      <span className="lin-deny-marker-label">Permission denied: {toolName}</span>
      <span className="lin-deny-marker-msg">{message}</span>
    </div>
  );
}
