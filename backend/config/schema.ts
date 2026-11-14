import { validate as validateCron } from "node-cron";
import { z } from "zod";

// Atlas hands out `mongodb+srv://`, local/self-hosted uses `mongodb://`.
const MONGODB_URL_PATTERN = /^mongodb(\+srv)?:\/\//i;

const databaseConfigSchema = z
    .object({
        /**
         * Full connection string (Atlas). When set it wins over every field
         * below, which exist for local/self-hosted development only.
         */
        Url: z
            .string()
            .trim()
            .refine(
                (value) => MONGODB_URL_PATTERN.test(value),
                "DATABASE_URL must be a mongodb:// or mongodb+srv:// connection string",
            )
            .optional(),
        /** URI scheme built from the discrete fields; Atlas requires srv. */
        Scheme: z.enum(["mongodb", "mongodb+srv"], "DATABASE_SCHEME must be mongodb or mongodb+srv"),
        Host: z.string().min(1, "Database host is required"),
        Port: z.coerce.number().int().positive(),
        // Empty credentials are valid: a local MongoDB usually runs without auth.
        User: z.string().trim(),
        Password: z.string().trim(),
        Name: z.string().min(1, "Database name is required"),
    })
    .superRefine((database, ctx) => {
        // A lone half of the credentials would silently skip authentication,
        // so refuse to boot instead of connecting without it.
        const hasUser = database.User.length > 0;
        const hasPassword = database.Password.length > 0;
        if (hasUser !== hasPassword) {
            ctx.addIssue({
                code: "custom",
                path: [hasUser ? "Password" : "User"],
                message: "DATABASE_USER and DATABASE_PASSWORD must be set together (or both left empty)",
            });
        }
    });

const jwtConfigSchema = z.object({
    Secret: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    ExpiresMinutes: z.coerce.number().int().positive(),
});

const rateLimitConfigSchema = z.object({
    WindowMs: z.coerce.number().int().positive(),
    Max: z.coerce.number().int().positive(),
    // Manual refreshes hit GitHub, so they get their own tighter budget.
    RefreshWindowMs: z.coerce.number().int().positive(),
    RefreshMax: z.coerce.number().int().positive(),
});

const githubConfigSchema = z.object({
    // No default on purpose: leaderboard refresh is pointless without credentials.
    Token: z.string().min(1, "GITHUB_TOKEN is required"),
    ApiUrl: z.string().url("GITHUB_API_URL must be a valid URL"),
    TimeoutMs: z.coerce.number().int().positive(),
});

const scoreWeightsSchema = z.object({
    Commit: z.coerce.number().nonnegative("SCORE_COMMIT must be >= 0"),
    PullRequest: z.coerce.number().nonnegative("SCORE_PR must be >= 0"),
    Review: z.coerce.number().nonnegative("SCORE_REVIEW must be >= 0"),
    Issue: z.coerce.number().nonnegative("SCORE_ISSUE must be >= 0"),
});

const leaderboardConfigSchema = z.object({
    Schedule: z
        .string()
        .min(1, "LEADERBOARD_CRON is required")
        .refine(validateCron, "LEADERBOARD_CRON must be a valid cron expression"),
    // Empty disables the scheduler (manual refresh still works for any org).
    Orgs: z.array(z.string().trim().min(1, "LEADERBOARD_ORGS entries must not be empty")),
});

const logConfigSchema = z.object({
    Level: z.enum(["debug", "info", "warn", "error"], "LOG_LEVEL must be debug, info, warn or error"),
});

export const configSchema = z.object({
    Database: databaseConfigSchema,
    Port: z.coerce.number().int().positive(),
    Jwt: jwtConfigSchema,
    RateLimit: rateLimitConfigSchema,
    GitHub: githubConfigSchema,
    Score: scoreWeightsSchema,
    Leaderboard: leaderboardConfigSchema,
    Log: logConfigSchema,
});

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type Config = z.infer<typeof configSchema>;
