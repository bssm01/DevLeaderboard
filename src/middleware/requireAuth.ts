import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/config.js";
import { HttpError } from "./errorHandler.js";

declare global {
    namespace Express {
        interface Request {
            /** Set by `requireAuth` once a JWT has been verified. */
            userId?: string;
        }
    }
}

// RFC 7235 says the auth scheme is case-insensitive; the token itself is
// opaque to us, so it must contain no whitespace.
const BEARER_PATTERN = /^Bearer\s+(\S+)\s*$/i;

/**
 * Verifies a `Authorization: Bearer <jwt>` header and exposes the user id as
 * `req.userId`. Every failure mode answers the same 401 so an attacker learns
 * nothing about which part of the token was wrong.
 */
export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const token = typeof header === "string" ? BEARER_PATTERN.exec(header.trim())?.[1] : undefined;

    if (token === undefined) {
        next(new HttpError(401, "Missing or malformed Authorization header"));
        return;
    }

    try {
        const payload = jwt.verify(token, config.Jwt.Secret);

        // `verify` returns a bare string for tokens signed with a plain payload.
        if (typeof payload === "string" || typeof payload.id !== "string" || payload.id.length === 0) {
            next(new HttpError(401, "Invalid token"));
            return;
        }

        req.userId = payload.id;
        next();
    } catch {
        // Expired, tampered with, wrong secret or simply not a JWT.
        next(new HttpError(401, "Invalid or expired token"));
    }
};
