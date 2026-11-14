import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ToastProvider } from "@/shared/ui/ToastProvider";
import { AuthProvider } from "@/features/auth/AuthProvider";

/**
 * One client for the whole app. The leaderboard is read-heavy and cheap to
 * cache, so queries stay fresh for a short window and refetch on focus.
 */
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

interface AppProvidersProps {
    children: ReactNode;
}

export const AppProviders = ({ children }: AppProvidersProps): ReactNode => (
    <QueryClientProvider client={queryClient}>
        <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
    </QueryClientProvider>
);
