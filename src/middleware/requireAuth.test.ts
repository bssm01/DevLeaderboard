import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config/config.js";
import { HttpError } from "./errorHandler.js";
import { requireAuth } from "./requireAuth.js";

type NextMock = ReturnType<typeof vi.fn>;

interface RunResult {
    req: Request;
    next: NextMock;
}

const run = (authorization?: string): RunResult => {
    const req = {
        headers: authorization === undefined ? {} : { authorization },
    } as unknown as Request;

    const next = vi.fn();
    requireAuth(req, {} as Response, next);

    return { req, next };
};

const errorFrom = (next: NextMock): HttpError => {
    expect(next).toHaveBeenCalledTimes(1);
    const [argument] = next.mock.calls[0] as [unknown];
    expect(argument).toBeInstanceOf(HttpError);
    return argument as HttpError;
};

const tokenFor = (payload: object, secret = config.Jwt.Secret): string =>
    jwt.sign(payload, secret, { expiresIn: "5m" });

beforeEach(() => {
    vi.clearAllMocks();
});

describe("requireAuth", () => {
    it("rejects a request with no Authorization header", () => {
        const { next } = run();

        expect(errorFrom(next).status).toBe(401);
        expect(errorFrom(next).message).toContain("Missing or malformed");
    });

    it("rejects a non-bearer scheme", () => {
        const { next } = run(`Basic ${Buffer.from("user:pass").toString("base64")}`);

        expect(errorFrom(next).status).toBe(401);
    });

    it("rejects a bare scheme with no token", () => {
        expect(errorFrom(run("Bearer").next).status).toBe(401);
        expect(errorFrom(run("Bearer    ").next).status).toBe(401);
    });

    it("rejects a token containing whitespace", () => {
        expect(errorFrom(run("Bearer abc def").next).status).toBe(401);
    });

    it("accepts a valid token and exposes the user id", () => {
        const userId = "6565f0e0a1b2c3d4e5f60718";
        const { req, next } = run(`Bearer ${tokenFor({ id: userId })}`);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.userId).toBe(userId);
    });

    it("accepts the scheme case-insensitively (RFC 7235)", () => {
        const userId = "6565f0e0a1b2c3d4e5f60718";
        const { req, next } = run(`bearer ${tokenFor({ id: userId })}`);

        expect(next).toHaveBeenCalledWith();
        expect(req.userId).toBe(userId);
    });

    it("rejects a token signed with a different secret", () => {
        const { req, next } = run(`Bearer ${tokenFor({ id: "u1" }, "some-other-secret-entirely")}`);

        expect(errorFrom(next).message).toContain("Invalid or expired");
        expect(req.userId).toBeUndefined();
    });

    it("rejects an expired token", () => {
        const expired = jwt.sign({ id: "u1" }, config.Jwt.Secret, { expiresIn: -60 });
        const { next } = run(`Bearer ${expired}`);

        expect(errorFrom(next).status).toBe(401);
    });

    it("rejects a token whose payload has no id", () => {
        const { req, next } = run(`Bearer ${tokenFor({ name: "no-id-here" })}`);

        expect(errorFrom(next).message).toBe("Invalid token");
        expect(req.userId).toBeUndefined();
    });

    it("rejects a token with an empty or non-string id", () => {
        expect(errorFrom(run(`Bearer ${tokenFor({ id: "" })}`).next).message).toBe("Invalid token");
        expect(errorFrom(run(`Bearer ${tokenFor({ id: 42 })}`).next).message).toBe("Invalid token");
    });

    it("rejects a token signed with a plain string payload", () => {
        const plain = jwt.sign("just-a-string", config.Jwt.Secret);

        expect(errorFrom(run(`Bearer ${plain}`).next).message).toBe("Invalid token");
    });

    it("rejects garbage that is not a JWT at all", () => {
        expect(errorFrom(run("Bearer not.a.jwt").next).message).toContain("Invalid or expired");
    });
});
