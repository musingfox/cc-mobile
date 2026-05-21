// Inline stroke-based 20×20 icon set. Source: tokens.jsx from claude.ai/design bundle.

import type { CSSProperties } from "react";

export type IconName =
  | "plus"
  | "close"
  | "chevronR"
  | "chevronL"
  | "chevronD"
  | "chevronU"
  | "send"
  | "folder"
  | "file"
  | "terminal"
  | "settings"
  | "search"
  | "check"
  | "x"
  | "menu"
  | "dots"
  | "clock"
  | "zap"
  | "at"
  | "slash"
  | "wrench"
  | "edit"
  | "sparkles"
  | "shield"
  | "eye"
  | "git"
  | "branch"
  | "layers"
  | "play"
  | "pause"
  | "stop"
  | "bell"
  | "tag"
  | "refresh"
  | "thinking"
  | "pin"
  | "pinFilled"
  | "star"
  | "starFilled"
  | "logo"
  | "swipe"
  | "arrow"
  | "copy"
  | "paperclip"
  | "image"
  | "camera"
  | "mic"
  | "circle"
  | "dot";

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 16,
  color = "currentColor",
  strokeWidth = 1.5,
  style,
}: IconProps) {
  const svgProps = {
    width: size,
    height: size,
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
  };

  switch (name) {
    case "plus":
      return (
        <svg {...svgProps}>
          <path d="M10 4v12M4 10h12" />
        </svg>
      );
    case "close":
    case "x":
      return (
        <svg {...svgProps}>
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
      );
    case "chevronR":
      return (
        <svg {...svgProps}>
          <path d="M7 4l6 6-6 6" />
        </svg>
      );
    case "chevronL":
      return (
        <svg {...svgProps}>
          <path d="M13 4l-6 6 6 6" />
        </svg>
      );
    case "chevronD":
      return (
        <svg {...svgProps}>
          <path d="M4 7l6 6 6-6" />
        </svg>
      );
    case "chevronU":
      return (
        <svg {...svgProps}>
          <path d="M4 13l6-6 6 6" />
        </svg>
      );
    case "send":
      return (
        <svg {...svgProps}>
          <path d="M3 10l14-6-4 14-3-6-7-2z" />
        </svg>
      );
    case "folder":
      return (
        <svg {...svgProps}>
          <path d="M2 5a1 1 0 011-1h4l2 2h7a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" />
        </svg>
      );
    case "file":
      return (
        <svg {...svgProps}>
          <path d="M5 3h6l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
          <path d="M11 3v4h4" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...svgProps}>
          <path d="M3 4h14v12H3z" />
          <path d="M6 8l3 2-3 2M10 12h5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...svgProps}>
          <circle cx="10" cy="10" r="2.5" />
          <path d="M10 1v3M10 16v3M19 10h-3M4 10H1M16.4 3.6l-2.1 2.1M5.7 14.3l-2.1 2.1M16.4 16.4l-2.1-2.1M5.7 5.7L3.6 3.6" />
        </svg>
      );
    case "search":
      return (
        <svg {...svgProps}>
          <circle cx="9" cy="9" r="5" />
          <path d="M13 13l4 4" />
        </svg>
      );
    case "check":
      return (
        <svg {...svgProps}>
          <path d="M4 10l4 4 8-9" />
        </svg>
      );
    case "menu":
      return (
        <svg {...svgProps}>
          <path d="M3 6h14M3 10h14M3 14h14" />
        </svg>
      );
    case "dots":
      return (
        <svg {...svgProps}>
          <circle cx="4" cy="10" r="1.5" fill={color} />
          <circle cx="10" cy="10" r="1.5" fill={color} />
          <circle cx="16" cy="10" r="1.5" fill={color} />
        </svg>
      );
    case "clock":
      return (
        <svg {...svgProps}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v4l2.5 2" />
        </svg>
      );
    case "zap":
      return (
        <svg {...svgProps}>
          <path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z" />
        </svg>
      );
    case "at":
      return (
        <svg {...svgProps}>
          <circle cx="10" cy="10" r="3" />
          <path d="M13 10v2a2 2 0 004 0v-2a7 7 0 10-3 5.7" />
        </svg>
      );
    case "slash":
      return (
        <svg {...svgProps}>
          <path d="M12 4l-4 12" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...svgProps}>
          <path d="M15 6a3 3 0 01-4 4L4 17l-1-1 7-7a3 3 0 014-4l-2 2 1 1 2-2z" />
        </svg>
      );
    case "edit":
      return (
        <svg {...svgProps}>
          <path d="M14 3l3 3-10 10H4v-3L14 3z" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...svgProps}>
          <path d="M10 3v4M10 13v4M3 10h4M13 10h4" />
        </svg>
      );
    case "shield":
      return (
        <svg {...svgProps}>
          <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5l7-3z" />
        </svg>
      );
    case "eye":
      return (
        <svg {...svgProps}>
          <path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z" />
          <circle cx="10" cy="10" r="2.5" />
        </svg>
      );
    case "git":
      return (
        <svg {...svgProps}>
          <circle cx="5" cy="5" r="2" />
          <circle cx="5" cy="15" r="2" />
          <circle cx="15" cy="10" r="2" />
          <path d="M5 7v6M7 5c5 0 6 2 6 5" />
        </svg>
      );
    case "branch":
      return (
        <svg {...svgProps}>
          <circle cx="5" cy="5" r="1.5" />
          <circle cx="5" cy="15" r="1.5" />
          <circle cx="15" cy="10" r="1.5" />
          <path d="M5 7v6M7 5c4 0 6 2 6 5" />
        </svg>
      );
    case "layers":
      return (
        <svg {...svgProps}>
          <path d="M10 2l8 4-8 4-8-4 8-4zM2 10l8 4 8-4M2 14l8 4 8-4" />
        </svg>
      );
    case "play":
      return (
        <svg {...svgProps}>
          <path d="M6 4l10 6-10 6V4z" fill={color} />
        </svg>
      );
    case "pause":
      return (
        <svg {...svgProps}>
          <path d="M6 4v12M14 4v12" strokeWidth={2.5} />
        </svg>
      );
    case "stop":
      return (
        <svg {...svgProps}>
          <rect x="5" y="5" width="10" height="10" fill={color} />
        </svg>
      );
    case "bell":
      return (
        <svg {...svgProps}>
          <path d="M10 2a5 5 0 00-5 5v3l-2 3h14l-2-3V7a5 5 0 00-5-5z" />
          <path d="M8 17a2 2 0 004 0" />
        </svg>
      );
    case "tag":
      return (
        <svg {...svgProps}>
          <path d="M2 10l8-8h7v7l-8 8-7-7z" />
          <circle cx="13" cy="7" r="1" fill={color} />
        </svg>
      );
    case "refresh":
      return (
        <svg {...svgProps}>
          <path d="M17 10a7 7 0 01-12 5M3 10a7 7 0 0112-5" />
          <path d="M3 4v4h4M17 16v-4h-4" />
        </svg>
      );
    case "thinking":
      return (
        <svg {...svgProps}>
          <circle cx="4" cy="10" r="1.5" fill={color} />
          <circle cx="10" cy="10" r="1.5" fill={color} />
          <circle cx="16" cy="10" r="1.5" fill={color} />
        </svg>
      );
    case "pin":
      return (
        <svg {...svgProps}>
          <path d="M8 2h4v5l3 3v2H5v-2l3-3V2z" />
          <path d="M10 12v6" />
        </svg>
      );
    case "pinFilled":
      return (
        <svg {...svgProps}>
          <path d="M8 2h4v5l3 3v2H5v-2l3-3V2z" fill={color} />
          <path d="M10 12v6" />
        </svg>
      );
    case "star":
      return (
        <svg {...svgProps}>
          <path d="M10 2l2.5 5 5.5.8-4 4 1 5.5L10 14.8 5 17.3l1-5.5-4-4 5.5-.8L10 2z" />
        </svg>
      );
    case "starFilled":
      return (
        <svg {...svgProps}>
          <path
            d="M10 2l2.5 5 5.5.8-4 4 1 5.5L10 14.8 5 17.3l1-5.5-4-4 5.5-.8L10 2z"
            fill={color}
          />
        </svg>
      );
    case "logo":
      return (
        <svg {...svgProps}>
          <path d="M4 10l4-6 4 12 4-6" strokeWidth={2} />
        </svg>
      );
    case "swipe":
      return (
        <svg {...svgProps}>
          <path d="M3 10h14M11 4l6 6-6 6" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...svgProps}>
          <path d="M4 10h12M11 5l5 5-5 5" />
        </svg>
      );
    case "copy":
      return (
        <svg {...svgProps}>
          <rect x="6" y="6" width="10" height="10" rx="1" />
          <path d="M4 12V4h8" />
        </svg>
      );
    case "paperclip":
      return (
        <svg {...svgProps}>
          <path d="M14 4l-8 8a3 3 0 104 4l7-7a5 5 0 00-7-7L3 10a7 7 0 0010 10" />
        </svg>
      );
    case "image":
      return (
        <svg {...svgProps}>
          <rect x="3" y="4" width="14" height="12" rx="1" />
          <circle cx="7.5" cy="8.5" r="1.2" fill={color} />
          <path d="M3 14l4-4 4 3 3-2 3 3" />
        </svg>
      );
    case "camera":
      return (
        <svg {...svgProps}>
          <path d="M3 6h3l1.5-2h5L14 6h3v10H3z" />
          <circle cx="10" cy="11" r="3" />
        </svg>
      );
    case "mic":
      return (
        <svg {...svgProps}>
          <rect x="8" y="2" width="4" height="9" rx="2" />
          <path d="M5 10a5 5 0 0010 0M10 15v3M7 18h6" />
        </svg>
      );
    case "circle":
      return (
        <svg {...svgProps}>
          <circle cx="10" cy="10" r="7" />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <circle cx="10" cy="10" r="3" fill={color} />
        </svg>
      );
  }
}
