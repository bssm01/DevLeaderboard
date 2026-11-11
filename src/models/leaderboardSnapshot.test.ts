import { describe, expect, it } from "vitest";
import type { Period } from "../services/leaderboard/periods.js";
import LeaderboardSnapshot, { upsertSnapshot } from "./leaderboardSnapshot.js";

const baseInput = {
    orgLogin: "AcmeCorp",
    period: "30d" as Period,
    windowFrom: new Date("2026-10-12T12:00:00.000Z"),
    windowTo: new Date("2026-11-11T12:00:00.000Z"),
    generatedAt: new Date("2026-11-11T12:00:00.000Z"),
    contributors: [],
    warnings: [],
};

/** Runs document validation locally — no database involved. */
const validate = async (doc: InstanceType<typeof LeaderboardSnapshot>): Promise<Error | undefined> =>
    doc.validate().then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    );

describe("LeaderboardSnapshot schema", () => {
    it("enforces exactly one snapshot per org and period", () => {
        const compound = LeaderboardSnapshot.schema
            .indexes()
            .find(([fields]) => Object.keys(fields).sort().join(",") === "orgLogin,period");

        expect(compound).toBeDefined();
        expect(compound?.[1]).toMatchObject({ unique: true });
    });

    it("lowercases the org login on write", () => {
        const doc = new LeaderboardSnapshot(baseInput);
        expect(doc.orgLogin).toBe("acmecorp");
    });

    it("rejects unsupported periods without touching the database", async () => {
        const doc = new LeaderboardSnapshot({ ...baseInput, period: "all" as unknown as Period });
        const error = await validate(doc);

        expect(error).toBeDefined();
        expect(error?.message).toContain("not a valid enum value");
    });

    it("accepts every supported period", async () => {
        for (const period of ["7d", "30d", "year"] as Period[]) {
            const doc = new LeaderboardSnapshot({ ...baseInput, period });
            expect(await validate(doc)).toBeUndefined();
        }
    });

    it("defaults contributors and warnings to empty arrays", () => {
        const doc = new LeaderboardSnapshot(baseInput);
        expect(doc.contributors).toEqual([]);
        expect(doc.warnings).toEqual([]);
    });

    it("requires the window fields", async () => {
        const doc = new LeaderboardSnapshot({
            orgLogin: "acme",
            period: "7d",
            generatedAt: new Date(),
            contributors: [],
            warnings: [],
        } as unknown as ConstructorParameters<typeof LeaderboardSnapshot>[0]);

        const error = await validate(doc);
        expect(error).toBeDefined();
        expect(error?.message).toContain("Path `windowFrom` is required");
    });
});

describe("upsertSnapshot", () => {
    it("is exported as a function for the sync layer", () => {
        expect(typeof upsertSnapshot).toBe("function");
    });
});
