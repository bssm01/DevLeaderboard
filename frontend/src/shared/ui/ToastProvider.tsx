import type { ReactNode } from "react";
import { ToastContext } from "./toastContext";
import { ToastViewport } from "./ToastViewport";
import { useToasts } from "@/shared/lib/useToasts";

/**
 * App-wide toast host. `pushToast` is the only surface features see —
 * the queue itself stays private to this provider.
 */
export const ToastProvider = ({ children }: { children: ReactNode }): ReactNode => {
    const { toasts, push, dismiss } = useToasts();

    return (
        <ToastContext.Provider value={push}>
            {children}
            <ToastViewport toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
};
