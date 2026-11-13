import { describe, expect, it } from "vitest";
import { configSchema } from "./schema.js";

const validRaw = {
    Database: {
        Host: "localhost",
        Port: "27017",
        Scheme: "mongodb",
        User: "",
        Password: "",
        Name: "devleaderboard",
    },
    Port: "3000",
    Jwt: { Secret: "a".repeat(32), ExpiresMinutes: "60" },
    RateLimit: { WindowMs: "900000", Max: "100", RefreshWindowMs: "900000", RefreshMax: "10" },
    GitHub: { Token: "ghp_valid_token_value", ApiUrl: "https://api.github.com", TimeoutMs: "15000" },
    Score: { Commit: "5", PullRequest: "10", Review: "3", Issue: "2" },
    Leaderboard: { Schedule: "0 */6 * * *", Orgs: ["acme", "other"] },
    Log: { Level: "info" },
};

describe("configSchema", () => {
    it("accepts a valid configuration and coerces numeric strings", () => {
        const result = configSchema.safeParse(validRaw);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.Port).toBe(3000);
            expect(result.data.Database.Port).toBe(27017);
            expect(result.data.Jwt.ExpiresMinutes).toBe(60);
            expect(result.data.RateLimit.Max).toBe(100);
        }
    });

    it("allows empty database credentials for a local unauthenticated MongoDB", () => {
        const result = configSchema.safeParse(validRaw);
        expect(result.success).toBe(true);
    });

    it("rejects a missing JWT secret", () => {
        const result = configSchema.safeParse({ ...validRaw, Jwt: { ...validRaw.Jwt, Secret: "" } });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((issue) => issue.message.includes("JWT_SECRET"))).toBe(true);
        }
    });

    it("rejects a JWT secret shorter than 16 characters", () => {
        const result = configSchema.safeParse({ ...validRaw, Jwt: { ...validRaw.Jwt, Secret: "too-short" } });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((issue) => issue.message.includes("JWT_SECRET"))).toBe(true);
        }
    });

    it("rejects an empty database name", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Database: { ...validRaw.Database, Name: "" },
        });

        expect(result.success).toBe(false);
    });

    it("rejects a non-numeric port", () => {
        const result = configSchema.safeParse({ ...validRaw, Port: "not-a-number" });
        expect(result.success).toBe(false);
    });

    it("rejects a non-positive rate limit", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            RateLimit: { ...validRaw.RateLimit, Max: "0" },
        });
        expect(result.success).toBe(false);
    });

    it("rejects a missing GitHub token", () => {
        const result = configSchema.safeParse({ ...validRaw, GitHub: { ...validRaw.GitHub, Token: "" } });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.some((issue) => issue.message.includes("GITHUB_TOKEN"))).toBe(true);
        }
    });

    it("rejects an invalid GitHub API URL", () => {
        const result = configSchema.safeParse({ ...validRaw, GitHub: { ...validRaw.GitHub, ApiUrl: "not-a-url" } });
        expect(result.success).toBe(false);
    });

    it("rejects a non-positive GitHub timeout", () => {
        const result = configSchema.safeParse({ ...validRaw, GitHub: { ...validRaw.GitHub, TimeoutMs: "0" } });
        expect(result.success).toBe(false);
    });

    it("coerces GitHub numeric strings", () => {
        const result = configSchema.safeParse(validRaw);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.GitHub.TimeoutMs).toBe(15000);
    });

    it("coerces score weights to numbers", () => {
        const result = configSchema.safeParse(validRaw);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.Score).toEqual({ Commit: 5, PullRequest: 10, Review: 3, Issue: 2 });
        }
    });

    it("rejects a negative score weight", () => {
        const result = configSchema.safeParse({ ...validRaw, Score: { ...validRaw.Score, Commit: "-1" } });
        expect(result.success).toBe(false);
    });

    it("rejects a non-positive refresh rate limit", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            RateLimit: { ...validRaw.RateLimit, RefreshMax: "0" },
        });
        expect(result.success).toBe(false);
    });

    it("rejects an invalid cron expression", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Leaderboard: { ...validRaw.Leaderboard, Schedule: "every six hours" },
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some((issue) => issue.message.includes("LEADERBOARD_CRON")),
            ).toBe(true);
        }
    });

    it("rejects a missing cron expression", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Leaderboard: { ...validRaw.Leaderboard, Schedule: "" },
        });
        expect(result.success).toBe(false);
    });

    it("accepts an empty org list (scheduler disabled) but not empty entries", () => {
        const disabled = configSchema.safeParse({
            ...validRaw,
            Leaderboard: { ...validRaw.Leaderboard, Orgs: [] },
        });
        expect(disabled.success).toBe(true);

        const blank = configSchema.safeParse({
            ...validRaw,
            Leaderboard: { ...validRaw.Leaderboard, Orgs: ["acme", "  "] },
        });
        expect(blank.success).toBe(false);
    });

    it("keeps the org list as an array of strings", () => {
        const result = configSchema.safeParse(validRaw);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.Leaderboard.Orgs).toEqual(["acme", "other"]);
    });

    it("accepts a known log level and rejects an unknown one", () => {
        const ok = configSchema.safeParse({ ...validRaw, Log: { Level: "debug" } });
        expect(ok.success).toBe(true);

        const bad = configSchema.safeParse({ ...validRaw, Log: { Level: "verbose" } });
        expect(bad.success).toBe(false);
        if (!bad.success) {
            expect(bad.error.issues.some((issue) => issue.message.includes("LOG_LEVEL"))).toBe(true);
        }
    });

    it("accepts an Atlas mongodb+srv connection string", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Database: {
                ...validRaw.Database,
                Url: "mongodb+srv://user:pass@cluster0.abcde.mongodb.net/wawachi?retryWrites=true&w=majority",
            },
        });

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.Database.Url).toContain("mongodb+srv://");
            // Trimming: pasted strings often carry stray whitespace.
            expect(result.data.Database.Url).not.toMatch(/^\s|\s$/);
        }
    });

    it("accepts a local mongodb:// connection string", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Database: { ...validRaw.Database, Url: "mongodb://localhost:27017/wawachi" },
        });
        expect(result.success).toBe(true);
    });

    it("leaves the connection string undefined when not provided", () => {
        const result = configSchema.safeParse(validRaw);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.Database.Url).toBeUndefined();
    });

    it("rejects a non-mongodb connection string (e.g. http or redis)", () => {
        for (const Url of ["http://localhost:27017", "redis://localhost:6379", "localhost:27017"]) {
            const result = configSchema.safeParse({
                ...validRaw,
                Database: { ...validRaw.Database, Url },
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(
                    result.error.issues.some((issue) => issue.message.includes("DATABASE_URL")),
                ).toBe(true);
            }
        }
    });

    it("accepts the mongodb+srv scheme for Atlas and rejects anything else", () => {
        const srv = configSchema.safeParse({
            ...validRaw,
            Database: { ...validRaw.Database, Scheme: "mongodb+srv" },
        });
        expect(srv.success).toBe(true);

        for (const Scheme of ["http", "mongo", "MONGODB+SRV", ""]) {
            const bad = configSchema.safeParse({
                ...validRaw,
                Database: { ...validRaw.Database, Scheme },
            });
            expect(bad.success).toBe(false);
            if (!bad.success) {
                expect(
                    bad.error.issues.some((issue) => issue.message.includes("DATABASE_SCHEME")),
                ).toBe(true);
            }
        }
    });

    it("rejects a username without a password (auth would be silently skipped)", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Database: { ...validRaw.Database, User: "admin" },
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some((issue) => issue.message.includes("DATABASE_PASSWORD")),
            ).toBe(true);
        }
    });

    it("rejects a password without a username", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Database: { ...validRaw.Database, Password: "secret" },
        });

        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some((issue) => issue.message.includes("DATABASE_USER")),
            ).toBe(true);
        }
    });

    it("accepts credentials set together", () => {
        const result = configSchema.safeParse({
            ...validRaw,
            Database: { ...validRaw.Database, User: "admin", Password: "s3cret" },
        });
        expect(result.success).toBe(true);
    });
});
