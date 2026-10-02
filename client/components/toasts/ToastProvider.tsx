import type { ReactNode } from "react";
import { Toaster } from "sonner";

interface ToastProviderProps {
  theme: "dark" | "light" | "claude" | "ember";
  children?: ReactNode;
}

// Every screen keeps its primary actions at the bottom (footer CTAs, the
// composer) and its navigation in a header at most 71px tall, so toasts drop in
// just under the header, below the status bar's safe area.
const BELOW_HEADER = "calc(env(safe-area-inset-top) + 72px)";

export default function ToastProvider({ theme, children }: ToastProviderProps) {
  const sonnerTheme = theme === "claude" || theme === "ember" ? "dark" : theme;

  return (
    <>
      {children}
      <Toaster
        theme={sonnerTheme}
        position="top-center"
        offset={{ top: BELOW_HEADER }}
        mobileOffset={{ top: BELOW_HEADER }}
        visibleToasts={3}
      />
    </>
  );
}
