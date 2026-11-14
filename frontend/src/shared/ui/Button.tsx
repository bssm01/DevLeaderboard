import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: Size;
    /** Renders a spinner and blocks interaction. */
    loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
    primary:
        "bg-accent-600 text-white hover:bg-accent-500 focus-visible:outline-accent-500 disabled:bg-accent-900 disabled:text-ink-faint",
    secondary:
        "border border-line bg-surface text-ink hover:bg-overlay focus-visible:outline-accent-500 disabled:text-ink-faint",
    ghost: "text-ink-muted hover:bg-overlay hover:text-ink focus-visible:outline-accent-500",
    danger: "bg-danger text-white hover:opacity-90 focus-visible:outline-danger",
};

const sizeClasses: Record<Size, string> = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
};

export const Button = ({
    variant = "primary",
    size = "md",
    loading = false,
    disabled,
    className,
    children,
    type = "button",
    ...rest
}: ButtonProps): ReactNode => (
    <button
        type={type}
        disabled={disabled || loading}
        aria-busy={loading}
        className={cn(
            "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
            "disabled:cursor-not-allowed",
            variantClasses[variant],
            sizeClasses[size],
            className,
        )}
        {...rest}
    >
        {loading && <Spinner />}
        {children}
    </button>
);

/** Small inline activity indicator sized to sit inside buttons. */
export const Spinner = ({ className }: { className?: string }): ReactNode => (
    <svg
        className={cn("size-4 animate-spin", className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
    >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
        <path
            d="M12 2a10 10 0 0 1 10 10"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
        />
    </svg>
);
