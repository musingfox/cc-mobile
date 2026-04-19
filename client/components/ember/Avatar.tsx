interface AvatarProps {
  label: string;
  size?: number;
  variant?: "gradient" | "neutral";
  shape?: "circle" | "square";
}

export default function Avatar({
  label,
  size = 22,
  variant = "gradient",
  shape = "circle",
}: AvatarProps) {
  // Extract 1-2 characters for avatar text
  const chars = (label ?? "")
    .split(" ")
    .map((word) => word[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const fontSize = size / 2 - 4;

  return (
    <div
      className={`ember-avatar ember-avatar--${variant} ember-avatar--${shape}`}
      style={
        {
          width: `${size}px`,
          height: `${size}px`,
          fontSize: `${fontSize}px`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      {chars}
    </div>
  );
}
