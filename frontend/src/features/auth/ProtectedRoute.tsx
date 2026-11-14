import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./authContext";

interface ProtectedRouteProps {
    children: ReactNode;
}

/**
 * Gates a route on an active session. Restoring the stored token is
 * synchronous, so there is no intermediate "not ready" frame to wait for.
 */
export const ProtectedRoute = ({ children }: ProtectedRouteProps): ReactNode => {
    const { user } = useAuth();
    const location = useLocation();

    if (user === null) {
        // `state.from` lets us return the user to where they were headed.
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    return children;
};
