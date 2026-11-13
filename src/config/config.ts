import dotenv from "dotenv";
import path from "node:path";
import { defaults } from "./default.js";
import { configSchema, type Config } from "./schema.js";

// Root .env is canonical; src/config/.env stays as a legacy fallback. Resolving
// from import.meta.dirname (rather than cwd) keeps this working both under
// `tsx src/server.ts` (src/config) and `node dist/server.js` (dist/config).
// dotenv never overrides variables already set in process.env.
const dotenvCandidates = [
    path.resolve(import.meta.dirname, "../../.env"),
    path.resolve(import.meta.dirname, "../../src/config/.env"),
];
for (const candidate of dotenvCandidates) {
    dotenv.config({ path: candidate, quiet: true });
}

function loadConfig(): Config {
    const raw = {
        Database: {
            // An empty value means "unset" so `DATABASE_URL=` in .env falls
            // back to the local host/port settings instead of failing.
            Url: process.env.DATABASE_URL?.trim() || undefined,
            Scheme: process.env.DATABASE_SCHEME ?? defaults.DATABASE_SCHEME,
            Host: process.env.DATABASE_HOST ?? defaults.DATABASE_HOST,
            Port: process.env.DATABASE_PORT ?? defaults.DATABASE_PORT,
            User: process.env.DATABASE_USER ?? defaults.DATABASE_USER,
            Password: process.env.DATABASE_PASSWORD ?? defaults.DATABASE_PASSWORD,
            Name: process.env.DATABASE_NAME ?? defaults.DATABASE_NAME,
        },
        Port: process.env.PORT ?? defaults.PORT,
        Jwt: {
            // No default on purpose: the app must refuse to boot without a secret.
            Secret: process.env.JWT_SECRET ?? "",
            ExpiresMinutes: process.env.JWT_EXPIRES_MINUTES ?? defaults.JWT_EXPIRES_MINUTES,
        },
        RateLimit: {
            WindowMs: process.env.RATE_LIMIT_WINDOW_MS ?? defaults.RATE_LIMIT_WINDOW_MS,
            Max: process.env.RATE_LIMIT_MAX ?? defaults.RATE_LIMIT_MAX,
            RefreshWindowMs:
                process.env.RATE_LIMIT_REFRESH_WINDOW_MS ?? defaults.RATE_LIMIT_REFRESH_WINDOW_MS,
            RefreshMax: process.env.RATE_LIMIT_REFRESH_MAX ?? defaults.RATE_LIMIT_REFRESH_MAX,
        },
        GitHub: {
            Token: process.env.GITHUB_TOKEN ?? "",
            ApiUrl: process.env.GITHUB_API_URL ?? defaults.GITHUB_API_URL,
            TimeoutMs: process.env.GITHUB_TIMEOUT_MS ?? defaults.GITHUB_TIMEOUT_MS,
        },
        Score: {
            Commit: process.env.SCORE_COMMIT ?? defaults.SCORE_COMMIT,
            PullRequest: process.env.SCORE_PR ?? defaults.SCORE_PR,
            Review: process.env.SCORE_REVIEW ?? defaults.SCORE_REVIEW,
            Issue: process.env.SCORE_ISSUE ?? defaults.SCORE_ISSUE,
        },
        Leaderboard: {
            Schedule: process.env.LEADERBOARD_CRON ?? defaults.LEADERBOARD_CRON,
            Orgs: (process.env.LEADERBOARD_ORGS ?? "")
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0),
        },
        Log: {
            Level: process.env.LOG_LEVEL ?? defaults.LOG_LEVEL,
        },
    };

    const result = configSchema.safeParse(raw);

    if (!result.success) {
        const issues = result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("\n");
        console.error(`Invalid configuration:\n${issues}`);
        process.exit(1);
    }

    return result.data;
}

export const config: Config = loadConfig();
