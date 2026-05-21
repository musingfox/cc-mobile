// Variant A — Linear-like neutral greyscale tokens.
// Source: /tmp/cc-mobile-design/cc-mobile/project/designs/variant-a-linear.jsx
// Color themes are deferred — this is the only palette for now.

export const tokens = {
  // Backgrounds
  bg: "#0e0e10", // Deep canvas
  surface: "#17171a", // Raised surface (sheets, cards)
  raised: "#1f1f23", // Hover / active / inline code

  // Borders
  border: "rgba(255,255,255,0.07)", // Subtle dividers
  borderStrong: "rgba(255,255,255,0.12)", // Sheet edges, active borders

  // Text
  fg: "#ececec", // Primary
  fg2: "#a0a0a0", // Secondary
  fg3: "#6a6a6a", // Tertiary / muted

  // Semantic accents (used inline at call sites)
  accentClaude: "#c2b89a", // Name, streaming dots, ring spinner, caret
  accentLive: "#6ca36c", // Active session dot
  accentWarn: "#c4a66a", // Permission required
  accentStreaming: "#e0b060", // Streaming tab pulse
  diffAddBorder: "#8aa88a",
  diffAddText: "#9ec09e",
  diffAddBg: "rgba(138,168,138,0.1)",
  diffRemoveBorder: "#c48a8a",
  diffRemoveText: "#d49898",
  diffRemoveBg: "rgba(196,138,138,0.1)",

  // Typography
  fontSans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
  fontMono: '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',

  // Radii
  r1: 4,
  r2: 6,
  r3: 8,
  r4: 10,
  r5: 12,
  r6: 16,
  r7: 18,

  // Spacing scale
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
} as const;

export type Tokens = typeof tokens;
