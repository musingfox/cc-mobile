/** Shared Framer Motion animation configs for the Neural Interface design system */

export const springTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 25,
};

export const springSnappy = {
  type: "spring" as const,
  stiffness: 400,
  damping: 20,
};

/** Message entry animation — spring-based fade + slide + scale */
export const messageEntry = {
  initial: { opacity: 0, y: 16, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
};

/** Slide up from bottom — for permission bar, toasts */
export const slideUp = {
  initial: { y: 100, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 100, opacity: 0 },
};

/** Fade in/out — for overlays, panels */
export const fadeInOut = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

/** Scale spring for button taps */
export const tapScale = {
  whileTap: { scale: 0.95 },
};

/** Streaming glow pulse keyframes */
export const streamingGlow = {
  boxShadow: [
    "0 0 0px rgba(0, 212, 255, 0)",
    "0 0 16px rgba(0, 212, 255, 0.35)",
    "0 0 0px rgba(0, 212, 255, 0)",
  ],
};

export const streamingGlowTransition = {
  duration: 2.5,
  repeat: Infinity,
  ease: "easeInOut" as const,
};
