import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { config } from "./config/config.js";
import User from "./models/userModel.js";
import { GitHubError } from "./services/github/errors.js";

vi.mock("./models/userModel.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./models/userModel.js")>();
    return {
        ...actual,
        default: {
            create: vi.fn(),
            findOne: vi.fn(),
        },
    };
});

vi.mock("./models/leaderboardSnapshot.js", () => ({
    findSnapshot: vi.fn(),
    findSnapshotSummaries: vi.fn(),
    upsertSnapshot: vi.fn(),
}));

vi.mock("./services/leaderboard/sync.js", () => ({
    syncLeaderboard: vi.fn(),
}));

import app from "./app.js";
import { findSnapshot, findSnapshotSummaries } from "./models/leaderboardSnapshot.js";
import { syncLeaderboard } from "./services/leaderboard/sync.js";

const createMock = User.create as unknown as Mock;
const findOneMock = User.findOne as unknown as Mock;
const findSnapshotMock = findSnapshot as unknown as Mock;
const findSummariesMock = findSnapshotSummaries as unknown as Mock;
const syncMock = syncLeaderboard as unknown as Mock;

const select = (user: object | null) => ({ select: vi.fn().mockResolvedValue(user) });

const validRegister = {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "secret1",
};

const validToken = (): string =>
    jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, config.Jwt.Secret, {
        expiresIn: 60,
    });

const snapshotDoc = (overrides: Record<string, unknown> = {}) => ({
    orgLogin: "acme",
    period: "30d",
    windowFrom: new Date("2026-10-12T00:00:00.000Z"),
    windowTo: new Date("2026-11-11T00:00:00.000Z"),
    generatedAt: new Date("2026-11-11T00:00:00.000Z"),
    contributors: [
        {
            key: "node-1",
            login: "bassem",
            avatarUrl: "https://avatars.example/1.png",
            commits: 10,
            pullRequests: 2,
            reviews: 3,
            issues: 1,
            score: 91,
            rank: 1,
        },
    ],
    warnings: [],
    ...overrides,
});

beforeEach(() => {
    createMock.mockReset();
    findOneMock.mockReset();
    findSnapshotMock.mockReset();
    findSummariesMock.mockReset();
    syncMock.mockReset();

    findSnapshotMock.mockResolvedValue(null);
    findSummariesMock.mockResolvedValue([]);
    syncMock.mockResolvedValue({
        orgLogin: "acme",
        period: "30d",
        generatedAt: new Date("2026-11-11T00:00:00.000Z"),
        entryCount: 1,
        warnings: [],
    });
});

describe("GET /health", () => {
    it("responds with status ok", async () => {
        const res = await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "ok" });
    });
});

describe("POST /auth/register", () => {
    it("creates a user, never returns the password hash, and returns a signed token", async () => {
        const _id = new mongoose.Types.ObjectId();
        createMock.mockResolvedValue({
            _id,
            name: validRegister.name,
            email: validRegister.email,
        });

        const res = await request(app).post("/auth/register").send(validRegister);

        expect(res.status).toBe(201);
        expect(res.body.user).toEqual({
            id: _id.toString(),
            name: validRegister.name,
            email: validRegister.email,
            image: "img/defaultUser.jpg",
        });
        expect(res.body.user).not.toHaveProperty("password");

        const decoded = jwt.verify(res.body.token, config.Jwt.Secret) as { id: string };
        expect(decoded.id).toBe(_id.toString());
    });

    it("stores a bcrypt hash, never the plaintext password", async () => {
        createMock.mockResolvedValue({
            _id: new mongoose.Types.ObjectId(),
            name: validRegister.name,
            email: validRegister.email,
        });

        await request(app).post("/auth/register").send(validRegister);

        const arg = createMock.mock.calls[0]?.[0] as { password: string };
        expect(arg.password).not.toBe(validRegister.password);
        expect(arg.password).toMatch(/^\$2/);
        expect(await bcrypt.compare(validRegister.password, arg.password)).toBe(true);
    });

    it("responds 409 when the email is already registered", async () => {
        createMock.mockRejectedValue(
            Object.assign(new Error("E11000 duplicate key error"), {
                code: 11000,
                keyPattern: { email: validRegister.email },
            }),
        );

        const res = await request(app).post("/auth/register").send(validRegister);

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: "email already in use" });
    });

    it("responds 400 for an invalid email", async () => {
        const res = await request(app)
            .post("/auth/register")
            .send({ ...validRegister, email: "not-an-email" });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(createMock).not.toHaveBeenCalled();
    });

    it("responds 400 for a password shorter than 6 characters", async () => {
        const res = await request(app).post("/auth/register").send({ ...validRegister, password: "12345" });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(createMock).not.toHaveBeenCalled();
    });
});

describe("POST /auth/login", () => {
    it("responds 401 for an unknown email without revealing that it is unknown", async () => {
        findOneMock.mockReturnValue(select(null));

        const res = await request(app)
            .post("/auth/login")
            .send({ email: "nobody@example.com", password: "secret1" });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: "Invalid email or password" });
    });

    it("responds 401 for a wrong password", async () => {
        findOneMock.mockReturnValue(
            select({
                _id: new mongoose.Types.ObjectId(),
                name: validRegister.name,
                email: validRegister.email,
                image: "img/defaultUser.jpg",
                password: await bcrypt.hash("correct-password", 10),
            }),
        );

        const res = await request(app)
            .post("/auth/login")
            .send({ email: validRegister.email, password: "wrong-password" });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: "Invalid email or password" });
    });

    it("returns a token and a user without the password hash on success", async () => {
        const _id = new mongoose.Types.ObjectId();
        findOneMock.mockReturnValue(
            select({
                _id,
                name: validRegister.name,
                email: validRegister.email,
                image: "img/ada.jpg",
                password: await bcrypt.hash(validRegister.password, 10),
            }),
        );

        const res = await request(app).post("/auth/login").send(validRegister);

        expect(res.status).toBe(200);
        expect(res.body.user).toEqual({
            id: _id.toString(),
            name: validRegister.name,
            email: validRegister.email,
            image: "img/ada.jpg",
        });
        expect(res.body.user).not.toHaveProperty("password");

        const decoded = jwt.verify(res.body.token, config.Jwt.Secret) as { id: string };
        expect(decoded.id).toBe(_id.toString());
    });

    it("asks the database for the password explicitly", async () => {
        const selectSpy = vi.fn().mockResolvedValue(null);
        findOneMock.mockReturnValue({ select: selectSpy });

        await request(app).post("/auth/login").send({ email: validRegister.email, password: "secret1" });

        expect(findOneMock).toHaveBeenCalledWith({ email: validRegister.email });
        expect(selectSpy).toHaveBeenCalledWith("+password");
    });
});

describe("GET /leaderboard/:org", () => {
    it("answers 202 while no snapshot exists", async () => {
        const res = await request(app).get("/leaderboard/acme");

        expect(res.status).toBe(202);
        expect(res.body).toMatchObject({ org: "acme", period: "30d" });
        expect(res.body.message).toContain("No snapshot yet");
        expect(findSnapshotMock).toHaveBeenCalledWith("acme", "30d");
    });

    it("serves the cached leaderboard with an ETag", async () => {
        findSnapshotMock.mockResolvedValue(snapshotDoc());

        const res = await request(app).get("/leaderboard/acme");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ org: "acme", total: 1, count: 1 });
        expect(res.body.entries[0]).toMatchObject({ login: "bassem", rank: 1, score: 91 });
        expect(res.headers.etag).toMatch(/^W\/"/);
    });

    it("answers 304 when the client revalidates with the current ETag", async () => {
        findSnapshotMock.mockResolvedValue(snapshotDoc());

        const first = await request(app).get("/leaderboard/acme");
        const second = await request(app)
            .get("/leaderboard/acme")
            .set("If-None-Match", first.headers.etag);

        expect(first.status).toBe(200);
        expect(second.status).toBe(304);
        expect(second.text).toBe("");
        // The snapshot is read from Mongo, not from GitHub, on every GET.
        expect(syncMock).not.toHaveBeenCalled();
    });

    it("answers 400 for an unsupported period", async () => {
        const res = await request(app).get("/leaderboard/acme?period=forever");

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Validation failed");
        expect(findSnapshotMock).not.toHaveBeenCalled();
    });

    it("answers 400 for an invalid org login", async () => {
        const res = await request(app).get("/leaderboard/not_a_real_org");

        expect(res.status).toBe(400);
        expect(findSnapshotMock).not.toHaveBeenCalled();
    });
});

describe("GET /leaderboard/:org/meta", () => {
    it("reports scoring rules, quota and snapshot freshness", async () => {
        findSummariesMock.mockResolvedValue([
            { period: "7d", generatedAt: new Date("2026-11-11T00:00:00.000Z"), entryCount: 12 },
        ]);

        const res = await request(app).get("/leaderboard/acme/meta");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            org: "acme",
            scoreWeights: config.Score,
            snapshots: [{ period: "7d", entryCount: 12 }],
        });
        expect(res.body).toHaveProperty("rateLimit");
    });
});

describe("POST /leaderboard/:org/refresh", () => {
    it("answers 401 without a token", async () => {
        const res = await request(app).post("/leaderboard/acme/refresh");

        expect(res.status).toBe(401);
        expect(res.body.error).toContain("Authorization");
        expect(syncMock).not.toHaveBeenCalled();
    });

    it("answers 401 for a garbage token", async () => {
        const res = await request(app)
            .post("/leaderboard/acme/refresh")
            .set("Authorization", "Bearer not.a.jwt");

        expect(res.status).toBe(401);
        expect(syncMock).not.toHaveBeenCalled();
    });

    it("refreshes all periods for a valid token", async () => {
        syncMock.mockImplementation(
            async (org: string, period: "7d" | "30d" | "year") => ({
                orgLogin: org,
                period,
                generatedAt: new Date("2026-11-11T00:00:00.000Z"),
                entryCount: 3,
                warnings: [],
            }),
        );

        const res = await request(app)
            .post("/leaderboard/acme/refresh")
            .set("Authorization", `Bearer ${validToken()}`);

        expect(res.status).toBe(200);
        expect(res.body.results.map((r: { period: string }) => r.period)).toEqual([
            "7d",
            "30d",
            "year",
        ]);
    });

    it("answers 400 for an invalid period even with a valid token", async () => {
        const res = await request(app)
            .post("/leaderboard/acme/refresh?period=forever")
            .set("Authorization", `Bearer ${validToken()}`);

        expect(res.status).toBe(400);
        expect(syncMock).not.toHaveBeenCalled();
    });

    it("answers 404 when GitHub does not know the org", async () => {
        syncMock.mockRejectedValue(new GitHubError("Organization not found: nope", 404));

        const res = await request(app)
            .post("/leaderboard/nope/refresh")
            .set("Authorization", `Bearer ${validToken()}`);

        expect(res.status).toBe(404);
        expect(res.body.error).toContain("not found on GitHub");
    });
});

describe("failure drill: the read path never depends on GitHub", () => {
    it("keeps serving the last snapshot when GitHub is unreachable", async () => {
        const previous = snapshotDoc();
        findSnapshotMock.mockResolvedValue(previous);
        syncMock.mockRejectedValue(
            new GitHubError("Network error contacting GitHub: connect ECONNREFUSED 127.0.0.1:9", 0),
        );

        const before = await request(app).get("/leaderboard/acme");
        const refresh = await request(app)
            .post("/leaderboard/acme/refresh")
            .set("Authorization", `Bearer ${validToken()}`);
        const after = await request(app).get("/leaderboard/acme");

        expect(before.status).toBe(200);
        expect(refresh.status).toBe(502); // upstream failed, not us
        expect(after.status).toBe(200);
        expect(after.body).toEqual(before.body);
        expect(after.body.entries[0]).toMatchObject({ login: "bassem", rank: 1 });
    });

    it("keeps serving when GitHub rate-limits the refresh", async () => {
        findSnapshotMock.mockResolvedValue(snapshotDoc());
        syncMock.mockRejectedValue(
            new GitHubError("API rate limit exceeded", 429, {
                remaining: 0,
                resetAt: new Date(Date.now() + 60_000),
            }),
        );

        const refresh = await request(app)
            .post("/leaderboard/acme/refresh")
            .set("Authorization", `Bearer ${validToken()}`);
        const read = await request(app).get("/leaderboard/acme");

        expect(refresh.status).toBe(503);
        expect(refresh.headers["retry-after"]).toBeDefined();
        expect(read.status).toBe(200);
        expect(read.body.total).toBe(1);
    });
});

describe("error handling", () => {
    it("responds 400 for a malformed JSON body", async () => {
        const res = await request(app)
            .post("/auth/login")
            .set("Content-Type", "application/json")
            .send("{invalid json");

        expect(res.status).toBe(400);
        // Exact wording is engine-specific, so only require a helpful message.
        expect(typeof res.body.error).toBe("string");
        expect(res.body.error.length).toBeGreaterThan(0);
        expect(res.body.error).not.toBe("Internal server error");
    });

    it("responds 404 for an unknown route", async () => {
        const res = await request(app).get("/definitely-not-a-route");
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Not found" });
    });
});
