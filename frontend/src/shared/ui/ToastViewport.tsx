import type { ReactNode } from "react";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import type { Toast } from "@/shared/lib/useToasts";

interface ToastViewportProps {
    toasts: readonly Toast[];
    onDismiss: (id: number) => void;
}

const toneClasses: Record<Toast["tone"], string> = {
    info: "border-line bg-surface text-ink",
    success: "border-success/40 bg-success/10 text-ink",
    error: "border-danger/40 bg-danger/10 text-ink",
};

const toneIcon: Record<Toast["tone"], ReactNode> = {
    info: <Info size={16} className="text-accent-400" aria-hidden />,
    success: <CheckCircle2 size={16} className="text-success" aria-hidden />,
    error: <XCircle size={16} className="text-danger" aria-hidden />,
};

/** Bottom-right toast stack. `aria-live` announces without stealing focus. */
export const ToastViewport = ({ toasts, onDismiss }: ToastViewportProps): ReactNode => (
    <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
    >
        {toasts.map((toast) => (
            <div
                key={toast.id}
                role="status"
                className={cn(
                    "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg",
                    "transition-all duration-200",
                    toneClasses[toast.tone],
                )}
            >
                <span className="mt-0.5 shrink-0">{toneIcon[toast.tone]}</span>
                <p className="flex-1 text-sm leading-relaxed">{toast.message}</p>
                <button
                    type="button"
                    onClick={() => onDismiss(toast.id)}
                    aria-label="Dismiss notification"
                    className="shrink-0 rounded-md p-0.5 text-ink-faint transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-500"
                >
                    <X size={14} aria-hidden />
                </button>
            </div>
        ))}
    </div>
);
