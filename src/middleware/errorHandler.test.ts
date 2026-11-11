import type { Request, Response } from "express";
import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorHandler, HttpError, notFound } from "./errorHandler.js";

interface FakeResponse {
    statusCode: number;
    body: unknown;
    status: (code: number) => FakeResponse;
    json: (payload: unknown) => FakeResponse;
}

const makeResponse = (): FakeResponse & Response => {
    const res: FakeResponse = {
        statusCode: 0,
        body: undefined,
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        json(payload: unknown) {
            res.body = payload;
            return res;
        },
    };
    return res as FakeResponse & Response;
};

const run = (err: unknown): FakeResponse => {
    const res = makeResponse();
    errorHandler(err, {} as Request, res, vi.fn());
    return res;
};

describe("notFound", () => {
    it("responds 404 with a JSON error", () => {
        const res = makeResponse();
        notFound({} as Request, res);
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: "Not found" });
    });
});

describe("errorHandler", () => {
    it("maps HttpError to its own status and message", () => {
        const res = run(new HttpError(401, "Invalid email or password"));
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ error: "Invalid email or password" });
    });

    it("maps ZodError to 400 with per-field details", () => {
        const schema = z.object({ email: z.email() });
        const result = schema.safeParse({ email: "nope" });

        const res = run(result.success ? new Error("unreachable") : result.error);

        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ error: "Validation failed" });
        const details = (res.body as { details: { path: string }[] }).details;
        expect(details[0]?.path).toBe("email");
    });

    it("maps Mongo duplicate key errors (11000) to 409 naming the field", () => {
        const err = Object.assign(new Error("E11000 duplicate key error"), {
            code: 11000,
            keyPattern: { email: "ada@example.com" },
        });

        const res = run(err);

        expect(res.statusCode).toBe(409);
        expect(res.body).toEqual({ error: "email already in use" });
    });

    it("maps mongoose CastError to 400", () => {
        const err = new mongoose.Error.CastError("User", "not-an-id", "_id");
        const res = run(err);
        expect(res.statusCode).toBe(400);
    });

    it("maps body-parser JSON syntax errors to 400", () => {
        const err = Object.assign(new SyntaxError("Unexpected token"), { status: 400, statusCode: 400 });
        const res = run(err);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: "Unexpected token" });
    });

    it("hides unexpected errors behind a generic 500", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        const res = run(new Error("secret internal detail"));

        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: "Internal server error" });
        expect(res.body).not.toContain("secret internal detail");
        expect(consoleSpy).toHaveBeenCalledOnce();
    });
});
