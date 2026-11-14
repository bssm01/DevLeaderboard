import { useCallback, useState, type ReactNode } from "react";
import { request } from "@/shared/api/client";
import type { AuthResponse, PublicUser } from "@/shared/api/types";
import { AuthContext, type AuthApi } from "./authContext";

const STORAGE_KEY = "dlb.auth";

interface StoredAuth {
    token: string;
    user: PublicUser;
}

/** Reads the persisted session once; corrupt storage must never block the app. */
const readStored = (): StoredAuth | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return null;

        const parsed = JSON.parse(raw) as Partial<StoredAuth>;
        if (typeof parsed.token !== "string" || typeof parsed.user?.id !== "string") return null;

        return { token: parsed.token, user: parsed.user as PublicUser };
    } catch {
        return null;
    }
};

/**
 * Session state backed by localStorage. The token is only ever sent as an
 * `Authorization` header — never in a URL, never logged.
 *
 * Restoring from localStorage is synchronous, so there is no async "ready"
 * phase and no flash of logged-out UI.
 */
export const AuthProvider = ({ children }: { children: ReactNode }): ReactNode => {
    const [session, setSession] = useState<StoredAuth | null>(() => readStored());

    const persist = useCallback((next: StoredAuth | null): void => {
        setSession(next);
        try {
            if (next === null) localStorage.removeItem(STORAGE_KEY);
            else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
            // Private mode / quota: the in-memory session still works.
        }
    }, []);

    const login = useCallback(
        async (email: string, password: string): Promise<void> => {
            const response = await request<AuthResponse>("/auth/login", {
                method: "POST",
                body: { email, password },
            });
            persist({ token: response.token, user: response.user });
        },
        [persist],
    );

    const register = useCallback(
        async (name: string, email: string, password: string): Promise<void> => {
            const response = await request<AuthResponse>("/auth/register", {
                method: "POST",
                body: { name, email, password },
            });
            persist({ token: response.token, user: response.user });
        },
        [persist],
    );

    const logout = useCallback(() => persist(null), [persist]);

    const value: AuthApi = {
        user: session?.user ?? null,
        token: session?.token ?? null,
        login,
        register,
        logout,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
