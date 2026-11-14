import { createContext, useContext } from "react";
import type { Toast } from "@/shared/lib/useToasts";

export type PushToast = (message: string, tone?: Toast["tone"]) => void;

/**
 * Bridge between <ToastProvider> and the rest of the app.
 * Kept in its own file so ToastProvider.tsx exports nothing but a component
 * (required for fast refresh).
 */
export const ToastContext = createContext<PushToast | null>(null);

/** Throws when used outside <ToastProvider> — a wiring bug, not a runtime state. */
export const useToast = (): PushToast => {
    const push = useContext(ToastContext);
    if (push === null) {
        throw new Error("useToast must be used within <ToastProvider>");
    }
    return push;
};
