import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "../config/config.js";
import { HttpError } from "../middleware/errorHandler.js";
import {
    findSnapshot,
    findSnapshotSummaries,
} from "../models/leaderboardSnapshot.js";
import { GitHubError } from "../services/github/errors.js";
import { githubClient } from "../services/github/githubClient.js";
import { PERIODS, type Period } from "../services/leaderboard/periods.js";
import { syncLeaderboard } from "../services/leaderboard/sync.js";
import type { SyncResult } from "../services/leaderboard/types.js";

/** GitHub logins: alphanumerics and single inner hyphens, max 39 chars. */
const ORG_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const orgParams = z.object({
    org: z
        .string()
        .trim()
        .min(1, "org is required")
        .max(39, "org must be at most 39 characters")
        .regex(ORG_LOGIN_PATTERN, "org must be a valid GitHub organization login"),
});

const listQuery = z.object({
    period: z.enum(PERIODS).default("30d"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

const refreshQuery = z.object({
    // Omitting it refreshes every period, matching the scheduled run.
    period: z.enum(PERIODS).optional(),
});

/** 403 is only "rate limited" when the quota is actually exhausted. */
const isRateLimited = (error: GitHubError): boolean =>
    error.status === 429 ||
    (error.status === 403 && (error.rateLimit?.remaining === 0 || /rate limit/i.test(error.message)));

/**
 * GitHub problems are upstream problems, so they surface as 4xx/502/503 and
 * never as a 500 from our side. The response is already committed as an error
 * by the time this returns, hence the `res` parameter for Retry-After.
 */
const toHttpError = (error: GitHubError, res: Response): HttpError => {
    if (error.status === 404) return new HttpError(404, "Organization not found on GitHub");

    if (isRateLimited(error)) {
        const reset = error.rateLimit?.resetAt;
        if (reset instanceof Date) {
            const seconds = Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000));
            res.setHeader("Retry-After", String(seconds));
        }
        return new HttpError(503, "GitHub rate limit reached, try again later");
    }

    if (error.status === 401 || error.status === 403) {
        return new HttpError(502, "GitHub rejected the server credentials");
    }

    return new HttpError(502, "GitHub is unavailable right now");
};

export const getLeaderboard = async (req: Request, res: Response): Promise<void> => {
    const { org } = orgParams.parse(req.params);
    const { period, limit } = listQuery.parse(req.query);

    const snapshot = await findSnapshot(org, period);

    if (snapshot === null) {
        // Not a failure: the schedule simply has not produced this yet.
        res.status(202).json({
            org: org.toLowerCase(),
            period,
            message: "No snapshot yet, trigger a refresh or wait for the scheduled run",
        });
        return;
    }

    const entries = snapshot.contributors.slice(0, limit);
    // Varies with the data AND the projection, so a stale list is never cached.
    const etag = `W/"${snapshot.generatedAt.getTime()}-${snapshot.contributors.length}-${limit}"`;

    res.set("ETag", etag);
    if (req.fresh) {
        res.status(304).end();
        return;
    }

    res.status(200).json({
        org: snapshot.orgLogin,
        period: snapshot.period,
        generatedAt: snapshot.generatedAt,
        windowFrom: snapshot.windowFrom,
        windowTo: snapshot.windowTo,
        total: snapshot.contributors.length,
        count: entries.length,
        warnings: snapshot.warnings,
        entries,
    });
};

export const getLeaderboardMeta = async (req: Request, res: Response): Promise<void> => {
    const { org } = orgParams.parse(req.params);

    const snapshots = await findSnapshotSummaries(org);
    // Reports only what the last GitHub response carried; never throws.
    const rateLimit = githubClient.getRateLimit();

    res.status(200).json({
        org: org.toLowerCase(),
        scoreWeights: config.Score,
        rateLimit: rateLimit ?? null,
        snapshots,
    });
};

export const refreshLeaderboard = async (req: Request, res: Response): Promise<void> => {
    const { org } = orgParams.parse(req.params);
    const { period } = refreshQuery.parse(req.query);

    const periods: readonly Period[] = period === undefined ? PERIODS : [period];
    const results: SyncResult[] = [];

    try {
        // Sequential on purpose: each run already batches its own GitHub calls.
        for (const target of periods) {
            results.push(await syncLeaderboard(org, target));
        }
    } catch (error) {
        if (error instanceof GitHubError) throw toHttpError(error, res);
        throw error;
    }

    res.status(200).json({ org: org.toLowerCase(), results });
};
