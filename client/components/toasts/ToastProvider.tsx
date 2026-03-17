import { Toaster } from "sonner";

interface ToastProviderProps {
  theme: "dark" | "light" | "claude";
}

export default function ToastProvider({ theme }: ToastProviderProps) {
  const sonnerTheme = theme === "claude" ? "dark" : theme;

  return <Toaster theme={sonnerTheme} position="bottom-center" visibleToasts={3} />;
}
