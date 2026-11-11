import { schedule, validate } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { config } from "../config/config.js";
import { logger } from "../lib/logger.js";
import { PERIODS, type Period } from "../services/leaderboard/periods.js";
import { syncLeaderboard } from "../services/leaderboard/sync.js";

export interface OrgRefreshOutcome {
    orgLogin: string;
    period: Period;
    ok: boolean;
    entryCount?: number;
    error?: string;
}

let task: ScheduledTask | undefined;

/**
 * Refreshes every period for one org, sequentially. A failure in one period
 * is recorded and swallowed so the remaining periods still run — the read
 * path keeps serving the previous snapshot either way.
 */
export const refreshOrg = async (orgLogin: string): Promise<OrgRefreshOutcome[]> => {
    const outcomes: OrgRefreshOutcome[] = [];

    for (const period of PERIODS) {
        try {
            const result = await syncLeaderboard(orgLogin, period);
            outcomes.push({
                orgLogin: result.orgLogin,
                period,
                ok: true,
                entryCount: result.entryCount,
            });
            logger.info(`refreshed ${result.orgLogin}/${period}`, {
                org: result.orgLogin,
                period,
                entryCount: result.entryCount,
            });
            for (const warning of result.warnings) {
                logger.warn(`warning for ${result.orgLogin}/${period}`, {
                    org: result.orgLogin,
                    period,
                    warning,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outcomes.push({
                orgLogin: orgLogin.toLowerCase(),
                period,
                ok: false,
                error: message,
            });
            logger.error(`refresh failed for ${orgLogin}/${period}`, {
                org: orgLogin,
                period,
                error: message,
            });
        }
    }

    return outcomes;
};

const runScheduled = async (orgs: readonly string[]): Promise<void> => {
    // One org at a time: a large org already issues many GitHub requests.
    for (const org of orgs) {
        await refreshOrg(org);
    }
};

/**
 * Starts the periodic refresh. An empty `LEADERBOARD_ORGS` disables the
 * scheduler entirely — manual refresh still works for any org.
 */
export const startRefreshCron = (): void => {
    stopRefreshCron();

    const { Schedule, Orgs } = config.Leaderboard;

    if (Orgs.length === 0) {
        logger.warn("LEADERBOARD_ORGS is empty, scheduled refresh is disabled");
        return;
    }

    // Config already validates this at boot; re-checking keeps the invariant
    // local to the only place that consumes it.
    if (!validate(Schedule)) {
        throw new Error(`Invalid LEADERBOARD_CRON expression: ${Schedule}`);
    }

    task = schedule(
        Schedule,
        () => runScheduled(Orgs),
        { noOverlap: true, unref: true },
    );

    logger.info(`scheduled refresh "${Schedule}"`, { schedule: Schedule, orgs: Orgs });
};

/** Stops the scheduler; safe to call when nothing is running. */
export const stopRefreshCron = (): void => {
    task?.stop();
    task = undefined;
};
