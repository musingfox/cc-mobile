import { toast } from "sonner";

export const toastService = {
  success: (message: string, duration = 4000) => toast.success(message, { duration }),
  error: (message: string, duration = 6000) => toast.error(message, { duration }),
  info: (message: string, duration = 4000) => toast(message, { duration }),
};
