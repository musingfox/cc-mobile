import { motion } from "framer-motion";
import type { ReactNode } from "react";

type AnimatedMessageProps = {
  children: ReactNode;
  index: number;
  className?: string;
};

export default function AnimatedMessage({ children, index, className }: AnimatedMessageProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.5) }}
    >
      {children}
    </motion.div>
  );
}
