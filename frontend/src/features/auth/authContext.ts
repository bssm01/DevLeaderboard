import { createContext, useContext } from "react";
import type { PublicUser } from "@/shared/api/types";

export interface AuthApi {
    user: PublicUser | null;
    token: string | null;
    login: (email: string, password: string) => Promise<void>;
    register: (name: string, email: string, password: string) => Promise<void>;
    logout: () => void;
}

/**
 * Bridge between <AuthProvider> and the rest of the app. Kept in its own file
 * so AuthProvider.tsx exports nothing but a component (required for fast refresh).
 */
export const AuthContext = createContext<AuthApi | null>(null);

/** Throws when used outside <AuthProvider> — a wiring bug, not a runtime state. */
export const useAuth = (): AuthApi => {
    const auth = useContext(AuthContext);
    if (auth === null) {
        throw new Error("useAuth must be used within <AuthProvider>");
    }
    return auth;
};
