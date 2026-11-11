import { EventEmitter } from "node:events";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../lib/logger.js";
import { createRequestLog } from "./requestLog.js";

class FakeResponse extends EventEmitter {
    statusCode = 200;
}

const makeLogger = (): Logger & { info: ReturnType<typeof vi.fn> } =>
    ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }) as Logger & { info: ReturnType<typeof vi.fn> };

const invoke = (log: Logger, req: Partial<Request>, res: FakeResponse) => {
    const next = vi.fn() as unknown as NextFunction;
    createRequestLog(log)(req as Request, res as unknown as Response, next);
    return next;
};

let log: ReturnType<typeof makeLogger>;
let res: FakeResponse;

beforeEach(() => {
    log = makeLogger();
    res = new FakeResponse();
});

describe("requestLog", () => {
    it("continues the chain immediately", () => {
        const next = invoke(log, { method: "GET", path: "/health" }, res);

        expect(next).toHaveBeenCalledTimes(1);
        expect(log.info).not.toHaveBeenCalled();
    });

    it("logs method, path, status and duration once the response finishes", () => {
        invoke(log, { method: "GET", path: "/leaderboard/acme" }, res);
        res.statusCode = 200;
        res.emit("finish");

        expect(log.info).toHaveBeenCalledTimes(1);
        const [message, fields] = log.info.mock.calls[0] as [string, Record<string, unknown>];
        expect(message).toBe("request");
        expect(fields).toMatchObject({
            method: "GET",
            path: "/leaderboard/acme",
            status: 200,
        });
        expect(typeof fields.durationMs).toBe("number");
        expect(fields.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("records the real status code, including failures", () => {
        invoke(log, { method: "POST", path: "/leaderboard/acme/refresh" }, res);
        res.statusCode = 502;
        res.emit("finish");

        expect(log.info.mock.calls[0][1]).toMatchObject({ status: 502 });
    });

    it("never logs the query string, which may carry credentials", () => {
        invoke(
            log,
            { method: "GET", path: "/leaderboard/acme", originalUrl: "/leaderboard/acme?token=shh" },
            res,
        );
        res.emit("finish");

        const fields = log.info.mock.calls[0][1] as Record<string, unknown>;
        expect(fields.path).toBe("/leaderboard/acme");
        expect(String(fields.path)).not.toContain("shh");
        expect(JSON.stringify(fields)).not.toContain("shh");
    });

    it("logs only on finish, not on other response events", () => {
        invoke(log, { method: "GET", path: "/health" }, res);
        res.emit("finish");
        res.emit("close");

        expect(log.info).toHaveBeenCalledTimes(1);
    });
});
