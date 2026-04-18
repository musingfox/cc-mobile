import { Toaster } from "sonner";

interface ToastProviderProps {
  theme: "dark" | "light" | "claude" | "ember";
}

export default function ToastProvider({ theme }: ToastProviderProps) {
  const sonnerTheme = theme === "claude" || theme === "ember" ? "dark" : theme;

  return <Toaster theme={sonnerTheme} position="bottom-center" visibleToasts={3} />;
}
