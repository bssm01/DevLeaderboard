import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

const capture = (level: "debug" | "info" | "warn" | "error") => {
    const spy =
        level === "error"
            ? vi.spyOn(console, "error").mockImplementation(() => undefined)
            : level === "warn"
              ? vi.spyOn(console, "warn").mockImplementation(() => undefined)
              : vi.spyOn(console, "log").mockImplementation(() => undefined);
    return spy;
};

/** All three streams at once, for assertions that span levels. */
const captureAll = () => ({
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
});

const parseLast = (spy: ReturnType<typeof capture>): Record<string, unknown> => {
    const [line] = spy.mock.calls.at(-1) as [string];
    return JSON.parse(line) as Record<string, unknown>;
};

describe("createLogger", () => {
    it("writes one JSON object per line with time, level and message", () => {
        const log = capture("info");
        createLogger({ level: "info" }).info("hello", { org: "acme" });

        const record = parseLast(log);
        expect(record.msg).toBe("hello");
        expect(record.level).toBe("info");
        expect(record.org).toBe("acme");
        expect(Number.isNaN(Date.parse(String(record.time)))).toBe(false);
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0]).toHaveLength(1);
    });

    it("routes warn and error to their own console streams", () => {
        const warn = capture("warn");
        const error = capture("error");
        const log = createLogger({ level: "info" });

        log.warn("careful");
        log.error("broken");

        expect(parseLast(warn)).toMatchObject({ level: "warn", msg: "careful" });
        expect(parseLast(error)).toMatchObject({ level: "error", msg: "broken" });
    });

    it("drops messages below the configured level", () => {
        const streams = captureAll();
        const logger = createLogger({ level: "warn" });

        logger.debug("noisy");
        logger.info("still noisy");
        logger.warn("now we talk");
        logger.error("and louder");

        expect(streams.log).not.toHaveBeenCalled();
        expect(streams.warn).toHaveBeenCalledTimes(1);
        expect(streams.error).toHaveBeenCalledTimes(1);
        expect((JSON.parse(streams.warn.mock.calls[0][0] as string) as { msg: string }).msg).toBe(
            "now we talk",
        );
    });

    it("emits nothing at level error except errors", () => {
        const log = capture("error");
        const logger = createLogger({ level: "error" });

        logger.debug("a");
        logger.info("b");
        logger.warn("c");
        logger.error("d");

        expect(log).toHaveBeenCalledTimes(1);
    });

    it("redacts anything that looks like a credential", () => {
        const log = capture("info");
        createLogger({ level: "debug" }).info("outbound", {
            token: "ghp_supersecret",
            nested: { Authorization: "Bearer abc", password: "hunter2" },
            safe: "acme",
        });

        const raw = log.mock.calls[0][0] as string;
        expect(raw).not.toContain("ghp_supersecret");
        expect(raw).not.toContain("hunter2");
        expect(raw).not.toContain("Bearer abc");
        expect(raw).toContain("[redacted]");
        expect(parseLast(log).safe).toBe("acme");
    });

    it("serializes Errors with name, message and stack", () => {
        const log = capture("error");
        createLogger({ level: "info" }).error("boom", { err: new Error("kaboom") });

        const record = parseLast(log).err as Record<string, string>;
        expect(record.name).toBe("Error");
        expect(record.message).toBe("kaboom");
        expect(record.stack).toContain("kaboom");
    });

    it("never throws on unserializable or cyclic fields", () => {
        const log = capture("info");
        const logger = createLogger({ level: "info" });
        const cyclic: Record<string, unknown> = { name: "loop" };
        cyclic.self = cyclic;

        expect(() => logger.info("cycle", { data: cyclic })).not.toThrow();
        expect(() => logger.info("bigint", { total: 10n })).not.toThrow();
        expect(log).toHaveBeenCalledTimes(2);
        // The message survives even when the fields do not.
        expect(parseLast(log).msg).toBe("bigint");
    });

    it("caps deep structures instead of walking forever", () => {
        const log = capture("info");
        let deep: Record<string, unknown> = { leaf: true };
        for (let index = 0; index < 10; index += 1) deep = { child: deep };

        createLogger({ level: "info" }).info("deep", { data: deep });

        expect(String(log.mock.calls[0][0])).toContain("depth limit reached");
    });

    it("keeps caller fields from overwriting the envelope", () => {
        const log = capture("info");
        createLogger({ level: "info" }).info("msg", { level: "forged", msg: "forged" });

        const record = parseLast(log);
        expect(record.level).toBe("info");
        expect(record.msg).toBe("msg");
    });
});
