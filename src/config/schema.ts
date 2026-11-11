import { validate as validateCron } from "node-cron";
import { z } from "zod";

export const databaseConfigSchema = z.object({
    Host: z.string().min(1, "Database host is required"),
    Port: z.coerce.number().int().positive(),
    // Empty credentials are valid: a local MongoDB usually runs without auth.
    User: z.string().trim(),
    Password: z.string().trim(),
    Name: z.string().min(1, "Database name is required"),
});

export const jwtConfigSchema = z.object({
    Secret: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    ExpiresMinutes: z.coerce.number().int().positive(),
});

export const rateLimitConfigSchema = z.object({
    WindowMs: z.coerce.number().int().positive(),
    Max: z.coerce.number().int().positive(),
    // Manual refreshes hit GitHub, so they get their own tighter budget.
    RefreshWindowMs: z.coerce.number().int().positive(),
    RefreshMax: z.coerce.number().int().positive(),
});

export const githubConfigSchema = z.object({
    // No default on purpose: leaderboard refresh is pointless without credentials.
    Token: z.string().min(1, "GITHUB_TOKEN is required"),
    ApiUrl: z.string().url("GITHUB_API_URL must be a valid URL"),
    TimeoutMs: z.coerce.number().int().positive(),
});

export const scoreWeightsSchema = z.object({
    Commit: z.coerce.number().nonnegative("SCORE_COMMIT must be >= 0"),
    PullRequest: z.coerce.number().nonnegative("SCORE_PR must be >= 0"),
    Review: z.coerce.number().nonnegative("SCORE_REVIEW must be >= 0"),
    Issue: z.coerce.number().nonnegative("SCORE_ISSUE must be >= 0"),
});

export const leaderboardConfigSchema = z.object({
    Schedule: z
        .string()
        .min(1, "LEADERBOARD_CRON is required")
        .refine(validateCron, "LEADERBOARD_CRON must be a valid cron expression"),
    // Empty disables the scheduler (manual refresh still works for any org).
    Orgs: z.array(z.string().trim().min(1, "LEADERBOARD_ORGS entries must not be empty")),
});

export const logConfigSchema = z.object({
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
export type JwtConfig = z.infer<typeof jwtConfigSchema>;
export type RateLimitConfig = z.infer<typeof rateLimitConfigSchema>;
export type GitHubConfig = z.infer<typeof githubConfigSchema>;
export type ScoreWeightsConfig = z.infer<typeof scoreWeightsSchema>;
export type LeaderboardConfig = z.infer<typeof leaderboardConfigSchema>;
export type LogConfig = z.infer<typeof logConfigSchema>;
export type Config = z.infer<typeof configSchema>;
