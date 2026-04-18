import type { ReactNode } from "react";
import { Toaster } from "sonner";

interface ToastProviderProps {
  theme: "dark" | "light" | "claude" | "ember";
  children?: ReactNode;
}

export default function ToastProvider({ theme, children }: ToastProviderProps) {
  const sonnerTheme = theme === "claude" || theme === "ember" ? "dark" : theme;

  return (
    <>
      {children}
      <Toaster theme={sonnerTheme} position="bottom-center" visibleToasts={3} />
    </>
  );
}
