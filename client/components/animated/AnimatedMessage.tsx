import { motion } from "framer-motion";
import type { ReactNode } from "react";
import {
  messageEntry,
  springTransition,
  streamingGlow,
  streamingGlowTransition,
} from "../../utils/motion-variants";

type AnimatedMessageProps = {
  children: ReactNode;
  index: number;
  className?: string;
  isStreaming?: boolean;
};

export default function AnimatedMessage({
  children,
  index,
  className,
  isStreaming,
}: AnimatedMessageProps) {
  return (
    <motion.div
      className={className}
      initial={messageEntry.initial}
      animate={{
        ...messageEntry.animate,
        ...(isStreaming ? { boxShadow: streamingGlow.boxShadow } : {}),
      }}
      transition={{
        ...springTransition,
        delay: Math.min(index * 0.03, 0.3),
        ...(isStreaming ? { boxShadow: streamingGlowTransition } : {}),
      }}
    >
      {children}
    </motion.div>
  );
}
