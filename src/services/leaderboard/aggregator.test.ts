import { describe, expect, it } from "vitest";
import { aggregate, isBotLogin, scoreOf } from "./aggregator.js";
import type { RawContributor, ScoreWeights } from "./types.js";

const WEIGHTS: ScoreWeights = { Commit: 5, PullRequest: 10, Review: 3, Issue: 2 };

const contributor = (overrides: Partial<RawContributor> & { key: string }): RawContributor => ({
    login: `user-${overrides.key}`,
    avatarUrl: "https://avatars.example/x.png",
    commits: 0,
    pullRequests: 0,
    reviews: 0,
    issues: 0,
    ...overrides,
});

describe("isBotLogin", () => {
    it("detects GitHub app bots", () => {
        expect(isBotLogin("dependabot[bot]")).toBe(true);
        expect(isBotLogin("github-actions[bot]")).toBe(true);
    });

    it("detects -bot suffixes and denylisted service accounts", () => {
        expect(isBotLogin("renovate-bot")).toBe(true);
        expect(isBotLogin("github-actions")).toBe(true);
        expect(isBotLogin("codecov")).toBe(true);
    });

    it("keeps human accounts, including ones ending in bot-ish letters", () => {
        expect(isBotLogin("abbot")).toBe(false); // no dash, not denylisted
        expect(isBotLogin("Bassem")).toBe(false);
        expect(isBotLogin("bot-laden")).toBe(false);
    });
});

describe("scoreOf", () => {
    it("applies each weight", () => {
        const score = scoreOf(
            { commits: 10, pullRequests: 3, reviews: 5, issues: 1 },
            WEIGHTS,
        );
        expect(score).toBe(10 * 5 + 3 * 10 + 5 * 3 + 1 * 2);
    });

    it("returns 0 for zero totals", () => {
        expect(scoreOf({ commits: 0, pullRequests: 0, reviews: 0, issues: 0 }, WEIGHTS)).toBe(0);
    });
});

describe("aggregate", () => {
    it("returns an empty leaderboard for empty input", () => {
        expect(aggregate([], WEIGHTS)).toEqual([]);
    });

    it("filters bots", () => {
        const entries = aggregate(
            [
                contributor({ key: "n1", login: "bassem", commits: 5 }),
                contributor({ key: "n2", login: "dependabot[bot]", commits: 999 }),
                contributor({ key: "n3", login: "renovate-bot", commits: 999 }),
                contributor({ key: "n4", login: "github-actions", commits: 999 }),
            ],
            WEIGHTS,
        );

        expect(entries.map((entry) => entry.login)).toEqual(["bassem"]);
    });

    it("merges duplicate node IDs and sums their totals", () => {
        const entries = aggregate(
            [
                contributor({ key: "n1", login: "bassem", commits: 4, reviews: 1 }),
                contributor({ key: "n1", login: "bassem", commits: 6, pullRequests: 2 }),
            ],
            WEIGHTS,
        );

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ commits: 10, reviews: 1, pullRequests: 2 });
        expect(entries[0].score).toBe(10 * 5 + 2 * 10 + 1 * 3);
    });

    it("skips entries without a key or login", () => {
        const entries = aggregate(
            [
                contributor({ key: "", login: "bassem", commits: 5 }),
                contributor({ key: "n1", login: "", commits: 5 }),
            ],
            WEIGHTS,
        );

        expect(entries).toEqual([]);
    });

    it("floors, clamps and repairs counts", () => {
        const entries = aggregate(
            [
                contributor({ key: "n1", login: "a", commits: 3.9, pullRequests: -4, reviews: Number.NaN, issues: 5 }),
            ],
            WEIGHTS,
        );

        expect(entries[0]).toMatchObject({ commits: 3, pullRequests: 0, reviews: 0, issues: 5 });
    });

    it("ranks by score descending with sequential ranks", () => {
        const entries = aggregate(
            [
                contributor({ key: "n1", login: "low", commits: 1 }),
                contributor({ key: "n2", login: "high", commits: 100 }),
                contributor({ key: "n3", login: "mid", commits: 50 }),
            ],
            WEIGHTS,
        );

        expect(entries.map((entry) => entry.login)).toEqual(["high", "mid", "low"]);
        expect(entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    });

    it("breaks score ties by commits, then by login (case-insensitive)", () => {
        const entries = aggregate(
            [
                contributor({ key: "n1", login: "Zoe", commits: 10 }), // same score, fewer commits
                contributor({ key: "n2", login: "amy", commits: 20 }),
                contributor({ key: "n3", login: "Bob", commits: 20 }),
            ],
            WEIGHTS,
        );

        // equal score (20 commits * 5), equal commits → login asc: amy < Bob
        expect(entries.map((entry) => entry.login)).toEqual(["amy", "Bob", "Zoe"]);
    });

    it("is deterministic: identical input yields identical output", () => {
        const input = [
            contributor({ key: "n1", login: "same", commits: 5 }),
            contributor({ key: "n2", login: "same", commits: 5 }),
        ];

        expect(aggregate(input, WEIGHTS)).toEqual(aggregate(input, WEIGHTS));
    });

    it("respects custom weights when ordering", () => {
        const input = [
            contributor({ key: "n1", login: "commit-hero", commits: 10, pullRequests: 0 }),
            contributor({ key: "n2", login: "pr-hero", commits: 0, pullRequests: 10 }),
        ];

        const commitHeavy = aggregate(input, { Commit: 10, PullRequest: 1, Review: 1, Issue: 1 });
        expect(commitHeavy[0].login).toBe("commit-hero");

        const prHeavy = aggregate(input, { Commit: 1, PullRequest: 10, Review: 1, Issue: 1 });
        expect(prHeavy[0].login).toBe("pr-hero");
    });

    it("assigns rank 1 to the top entry", () => {
        const entries = aggregate([contributor({ key: "n1", login: "only", commits: 1 })], WEIGHTS);
        expect(entries[0].rank).toBe(1);
    });
});
