import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
    id: number;
    message: string;
    tone: "info" | "success" | "error";
}

const TOAST_DURATION_MS = 5_000;

/**
 * Minimal toast queue — no global store, no context.
 * Every pushed toast auto-dismisses; timers are cleaned up on unmount.
 */
export const useToasts = (): {
    toasts: readonly Toast[];
    push: (message: string, tone?: Toast["tone"]) => void;
    dismiss: (id: number) => void;
} => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timersRef = useRef(new Map<number, number>());
    const nextIdRef = useRef(0);

    const dismiss = useCallback((id: number): void => {
        const timer = timersRef.current.get(id);
        if (timer !== undefined) window.clearTimeout(timer);
        timersRef.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const push = useCallback(
        (message: string, tone: Toast["tone"] = "info"): void => {
            const id = ++nextIdRef.current;
            setToasts((current) => [...current, { id, message, tone }]);
            timersRef.current.set(id, window.setTimeout(() => dismiss(id), TOAST_DURATION_MS));
        },
        [dismiss],
    );

    // Clear every pending timer if the host unmounts.
    useEffect(
        () => () => {
            timersRef.current.forEach((timer) => window.clearTimeout(timer));
            timersRef.current.clear();
        },
        [],
    );

    return { toasts, push, dismiss };
};
