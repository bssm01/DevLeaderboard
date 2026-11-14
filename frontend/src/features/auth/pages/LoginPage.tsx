import { useState, type ReactNode } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError } from "@/shared/api/client";
import { formatRetryDelay } from "@/shared/lib/format";
import { Button } from "@/shared/ui/Button";
import { useAuth } from "../authContext";
import { AuthShell } from "../components/AuthShell";
import { AuthField } from "../components/AuthField";

const loginSchema = z.object({
    email: z.string().trim().email("Enter a valid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;

/** Maps an ApiError to a form-level message the user can act on. */
const describeError = (error: unknown): string => {
    if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";

    switch (error.status) {
        case 401:
            return "Invalid email or password.";
        case 429:
            return error.retryAfterSeconds === null
                ? "Too many attempts. Please wait a moment and try again."
                : `Too many attempts. Try again in ${formatRetryDelay(error.retryAfterSeconds)}.`;
        case 0:
            return error.message;
        default:
            return error.message;
    }
};

export const LoginPage = (): ReactNode => {
    const { login, user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [formError, setFormError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginForm>({
        resolver: zodResolver(loginSchema),
        defaultValues: { email: "", password: "" },
    });

    // Already signed in — no reason to show the form.
    if (user !== null) {
        const from = (location.state as { from?: string } | null)?.from ?? "/";
        return <Navigate to={from} replace />;
    }

    const onSubmit = async (values: LoginForm): Promise<void> => {
        setFormError(null);
        try {
            await login(values.email, values.password);
            const from = (location.state as { from?: string } | null)?.from ?? "/";
            navigate(from, { replace: true });
        } catch (error) {
            setFormError(describeError(error));
        }
    };

    return (
        <AuthShell
            title="Welcome back"
            description="Sign in to trigger leaderboard refreshes."
            footer={{ prompt: "No account yet?", to: "/register", label: "Create one" }}
        >
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
                {formError !== null && (
                    <p
                        role="alert"
                        className="rounded-lg border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-ink"
                    >
                        {formError}
                    </p>
                )}

                <AuthField
                    label="Email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    error={errors.email?.message}
                    {...register("email")}
                />

                <AuthField
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    error={errors.password?.message}
                    {...register("password")}
                />

                <Button type="submit" loading={isSubmitting} className="w-full">
                    Sign in
                </Button>
            </form>
        </AuthShell>
    );
};
