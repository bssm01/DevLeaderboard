import type { InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
    label: string;
    /** Server- or schema-provided message; empty string hides the error. */
    error?: string;
}

/** Labelled input with an inline error slot — one source of truth for a11y ids. */
export const AuthField = ({ label, error, id, className, ...rest }: AuthFieldProps): React.ReactNode => {
    const fieldId = id ?? `field-${rest.name}`;
    const errorId = `${fieldId}-error`;
    const hasError = error !== undefined && error.length > 0;

    return (
        <div className="space-y-1.5">
            <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
                {label}
            </label>
            <input
                id={fieldId}
                aria-invalid={hasError}
                aria-describedby={hasError ? errorId : undefined}
                className={cn(
                    "h-10 w-full rounded-lg border bg-overlay px-3.5 text-sm text-ink placeholder:text-ink-faint",
                    "focus:outline-none focus:ring-2 focus:ring-accent-500/25",
                    hasError ? "border-danger" : "border-line focus:border-accent-500",
                    className,
                )}
                {...rest}
            />
            {hasError && (
                <p id={errorId} role="alert" className="text-sm text-danger">
                    {error}
                </p>
            )}
        </div>
    );
};
