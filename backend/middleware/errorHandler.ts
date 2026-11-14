import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export class HttpError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = "HttpError";
        this.status = status;
    }
}

interface ErrorWithStatus {
    status?: number;
    statusCode?: number;
    message?: string;
}

interface DuplicateKeyError {
    code: number;
    keyPattern?: Record<string, unknown>;
}

const isDuplicateKeyError = (err: unknown): err is DuplicateKeyError =>
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;

export const notFound = (_req: Request, res: Response): void => {
    res.status(404).json({ error: "Not found" });
};

export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void => {
    if (err instanceof ZodError) {
        res.status(400).json({
            error: "Validation failed",
            details: err.issues.map((issue) => ({
                path: issue.path.map(String).join("."),
                message: issue.message,
            })),
        });
        return;
    }

    if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
    }

    if (err instanceof mongoose.Error.CastError) {
        res.status(400).json({ error: "Invalid value for a request parameter" });
        return;
    }

    if (err instanceof mongoose.Error.ValidationError) {
        res.status(400).json({
            error: "Validation failed",
            details: Object.values(err.errors).map((e) => ({
                path: e.path,
                message: e.message,
            })),
        });
        return;
    }

    if (isDuplicateKeyError(err)) {
        const field = err.keyPattern ? Object.keys(err.keyPattern)[0] : undefined;
        res.status(409).json({ error: field ? `${field} already in use` : "Resource already exists" });
        return;
    }

    // Body-parser errors (e.g. malformed JSON) already carry a 4xx status.
    const status = (err as ErrorWithStatus | null)?.status ?? (err as ErrorWithStatus | null)?.statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
        const message = (err as ErrorWithStatus).message ?? "Bad request";
        res.status(status).json({ error: message });
        return;
    }

    logger.error("unhandled error", { err });
    res.status(500).json({ error: "Internal server error" });
};
