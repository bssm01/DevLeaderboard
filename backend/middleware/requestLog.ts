import type { NextFunction, Request, Response } from "express";
import { logger, type Logger } from "../lib/logger.js";

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;

/**
 * Emits one structured line per finished request.
 *
 * `req.path` is logged rather than `originalUrl` on purpose: query strings can
 * carry credentials, and a log line should never be a place secrets escape to.
 */
const createRequestLog =
    (log: Logger = logger) =>
    (req: Request, res: Response, next: NextFunction): void => {
        const startedAt = process.hrtime.bigint();

        res.on("finish", () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            log.info("request", {
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: roundToOneDecimal(durationMs),
            });
        });

        next();
    };

export const requestLog = createRequestLog();
