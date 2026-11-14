import { useMutation, useQuery, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { request, ApiError } from "@/shared/api/client";
import type { LeaderboardMeta, LeaderboardResult, Period, RefreshResponse } from "@/shared/api/types";
import { useAuth } from "@/features/auth/authContext";
import { useToast } from "@/shared/ui/toastContext";
import { formatRetryDelay } from "@/shared/lib/format";

export interface LeaderboardParams {
    org: string;
    period: Period;
    limit: number;
}

/** 429/5xx must not silently replace a good cached snapshot with an error. */
const shouldRetry = (failureCount: number, error: unknown): boolean => {
    const status = error instanceof Error && "status" in error ? (error as { status: number }).status : 0;
    // Network failures (0) and 5xx are worth one retry; 4xx are deterministic.
    if (status === 0 || status >= 500) return failureCount < 1;
    return false;
};

export const leaderboardKey = (params: LeaderboardParams): readonly unknown[] => [
    "leaderboard",
    params.org,
    params.period,
    params.limit,
];

/** Snapshot for one org+period — served from Mongo, never from GitHub. */
export const useLeaderboard = (params: LeaderboardParams) =>
    useQuery<LeaderboardResult>({
        queryKey: leaderboardKey(params),
        queryFn: () =>
            request<LeaderboardResult>(
                `/leaderboard/${encodeURIComponent(params.org)}?period=${params.period}&limit=${params.limit}`,
                { etag: true },
            ),
        retry: shouldRetry,
        // A 202 "no snapshot yet" is a valid, stable answer — don't refetch it.
        staleTime: 15_000,
    });

/** Weights, GitHub quota and snapshot freshness for the meta panel. */
export const useLeaderboardMeta = (org: string) =>
    useQuery<LeaderboardMeta>({
        queryKey: ["leaderboard-meta", org],
        queryFn: () => request<LeaderboardMeta>(`/leaderboard/${encodeURIComponent(org)}/meta`),
        staleTime: 30_000,
        retry: shouldRetry,
    });

/**
 * Triggers a GitHub re-sync. Costs quota and is rate-limited server-side, so
 * every outcome is surfaced as a toast and a successful run invalidates the
 * affected queries so the table re-renders with fresh data.
 *
 * @param period omit to refresh all three periods (the backend's default).
 */
export const useRefresh = (org: string) => {
    const queryClient = useQueryClient();
    const { token, logout } = useAuth();
    const pushToast = useToast();
    const navigate = useNavigate();
    const location = useLocation();

    const options: UseMutationOptions<RefreshResponse, ApiError, Period | undefined, unknown> = {
        mutationFn: async (period: Period | undefined) =>
            request<RefreshResponse>(
                `/leaderboard/${encodeURIComponent(org)}/refresh${
                    period === undefined ? "" : `?period=${period}`
                }`,
                { method: "POST", token: token ?? undefined },
            ),
        onSuccess: (response) => {
            // Drop the ETag copies: the snapshot changed, so the cached
            // validators are meaningless now.
            queryClient.removeQueries({ queryKey: ["leaderboard", org], exact: false });
            void queryClient.invalidateQueries({ queryKey: ["leaderboard-meta", org] });

            const periods = response.results.map((result) => result.period).join(", ");
            pushToast(`Refreshed ${periods} for ${response.org}.`, "success");
        },
        onError: (error) => {
            // Read once so narrowing inside branches can't invalidate the rest.
            const status: number = error.status;
            const retryAfterSeconds: number | null = error.retryAfterSeconds;
            const message: string = error.message;

            // Token rejected: the session is over, so end it and offer a way back.
            if (status === 401) {
                logout();
                pushToast("Your session expired. Please sign in again.", "error");
                navigate("/login", { replace: true, state: { from: location.pathname } });
                return;
            }

            if (status === 429) {
                pushToast(
                    retryAfterSeconds === null
                        ? "Too many refreshes. Please wait a moment and try again."
                        : `Too many refreshes. Try again in ${formatRetryDelay(retryAfterSeconds)}.`,
                    "error",
                );
                return;
            }

            pushToast(message, "error");
        },
    };

    const refreshMutation = useMutation(options);

    return refreshMutation;
};
