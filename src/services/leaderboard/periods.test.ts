import { describe, expect, it } from "vitest";
import { isPeriod, windowFor, PERIODS } from "./periods.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("windowFor", () => {
    it("builds an exact 7-day window", () => {
        const { from, to } = windowFor("7d", NOW);

        expect(to.toISOString()).toBe(NOW.toISOString());
        expect(to.getTime() - from.getTime()).toBe(7 * DAY_MS);
    });

    it("builds an exact 30-day window", () => {
        const { from, to } = windowFor("30d", NOW);

        expect(to.getTime() - from.getTime()).toBe(30 * DAY_MS);
    });

    it("keeps the year window inside GitHub's one-year limit", () => {
        const { from, to } = windowFor("year", NOW);

        const days = (to.getTime() - from.getTime()) / DAY_MS;
        expect(days).toBeLessThanOrEqual(365);
        expect(days).toBeGreaterThanOrEqual(364);
    });

    it("always has from before to", () => {
        for (const period of PERIODS) {
            const { from, to } = windowFor(period, NOW);
            expect(from.getTime()).toBeLessThan(to.getTime());
        }
    });

    it("is deterministic for a fixed now", () => {
        expect(windowFor("30d", NOW).from.toISOString()).toBe(windowFor("30d", NOW).from.toISOString());
    });

    it("produces UTC timestamps", () => {
        const { from, to } = windowFor("7d", NOW);
        expect(from.toISOString().endsWith("Z")).toBe(true);
        expect(to.toISOString().endsWith("Z")).toBe(true);
    });
});

describe("isPeriod", () => {
    it("accepts supported periods", () => {
        for (const period of PERIODS) expect(isPeriod(period)).toBe(true);
    });

    it("rejects anything else", () => {
        expect(isPeriod("all")).toBe(false);
        expect(isPeriod("1y")).toBe(false);
        expect(isPeriod(42)).toBe(false);
        expect(isPeriod(undefined)).toBe(false);
        expect(isPeriod(null)).toBe(false);
    });
});
