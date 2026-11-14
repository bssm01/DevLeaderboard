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

// Mirrors the backend's register schema so most mistakes are caught before
// a round-trip; anything the server rejects additionally shows as a form error.
const registerSchema = z
    .object({
        name: z.string().trim().min(1, "Name is required"),
        email: z.string().trim().email("Enter a valid email address"),
        password: z.string().min(6, "Password must be at least 6 characters"),
        confirmPassword: z.string(),
    })
    .refine((values) => values.password === values.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
    });

type RegisterForm = z.infer<typeof registerSchema>;

const describeError = (error: unknown): string => {
    if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";

    switch (error.status) {
        case 409:
            return "An account with that email already exists.";
        case 429:
            return error.retryAfterSeconds === null
                ? "Too many attempts. Please wait a moment and try again."
                : `Too many attempts. Try again in ${formatRetryDelay(error.retryAfterSeconds)}.`;
        default:
            return error.message;
    }
};

export const RegisterPage = (): ReactNode => {
    const { register: createAccount, user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [formError, setFormError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<RegisterForm>({
        resolver: zodResolver(registerSchema),
        defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    });

    if (user !== null) {
        return <Navigate to="/" replace />;
    }

    const onSubmit = async (values: RegisterForm): Promise<void> => {
        setFormError(null);
        try {
            await createAccount(values.name, values.email, values.password);
            const from = (location.state as { from?: string } | null)?.from ?? "/";
            navigate(from, { replace: true });
        } catch (error) {
            setFormError(describeError(error));
        }
    };

    return (
        <AuthShell
            title="Create your account"
            description="Needed to trigger leaderboard refreshes for your organization."
            footer={{ prompt: "Already have an account?", to: "/login", label: "Sign in" }}
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
                    label="Name"
                    autoComplete="name"
                    placeholder="Ada Lovelace"
                    error={errors.name?.message}
                    {...register("name")}
                />

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
                    autoComplete="new-password"
                    placeholder="At least 6 characters"
                    error={errors.password?.message}
                    {...register("password")}
                />

                <AuthField
                    label="Confirm password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                    error={errors.confirmPassword?.message}
                    {...register("confirmPassword")}
                />

                <Button type="submit" loading={isSubmitting} className="w-full">
                    Create account
                </Button>
            </form>
        </AuthShell>
    );
};
