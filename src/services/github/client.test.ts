import { describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "./client.js";
import { GitHubError } from "./errors.js";
import type { RateLimitInfo, RestClientOptions } from "./types.js";

const TOKEN = "ghp_unit_test_token_do_not_leak";

interface SetupResult {
    client: ReturnType<typeof createGitHubClient>;
    fetchMock: ReturnType<typeof vi.fn>;
    sleep: ReturnType<typeof vi.fn>;
}

/** Queue of responses/errors the mock fetch will return, in order. */
const setup = (queue: Array<Response | Error>, overrides: Partial<RestClientOptions> = {}): SetupResult => {
    const fetchMock = vi.fn();
    for (const entry of queue) {
        if (entry instanceof Error) fetchMock.mockRejectedValueOnce(entry);
        else fetchMock.mockResolvedValueOnce(entry);
    }
    const sleep = vi.fn(async () => undefined);

    const client = createGitHubClient({
        token: TOKEN,
        fetchImpl: fetchMock as unknown as typeof fetch,
        sleep: sleep as unknown as (ms: number) => Promise<void>,
        ...overrides,
    });

    return { client, fetchMock, sleep };
};

const jsonResponse = (
    body: unknown,
    init: { status?: number; headers?: Record<string, string> } = {},
): Response =>
    new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "Content-Type": "application/json", ...init.headers },
    });

const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected the promise to reject");
};

describe("createGitHubClient", () => {
    it("rejects construction without a token", () => {
        expect(() => createGitHubClient({ token: "" })).toThrow("token is required");
    });

    it("sends authentication and API-version headers on every request", async () => {
        const { client, fetchMock } = setup([jsonResponse({ login: "octocat" })]);

        const data = await client.request<{ login: string }>("/user");

        expect(data.login).toBe("octocat");
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe("https://api.github.com/user");
        expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(init.headers.Accept).toBe("application/vnd.github+json");
        expect(init.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
        expect(init.headers["User-Agent"]).toBe("wawachi-leaderboard");
    });

    it("does not retry a 404", async () => {
        const { client, fetchMock, sleep } = setup([jsonResponse({ message: "Not Found" }, { status: 404 })]);

        const error = await captureError(client.request("/orgs/does-not-exist"));

        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).status).toBe(404);
        expect((error as GitHubError).message).toContain("Not Found");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it("retries a 500 with backoff and then succeeds", async () => {
        const { client, fetchMock, sleep } = setup([
            jsonResponse({ message: "Server Error" }, { status: 500 }),
            jsonResponse({ ok: true }),
        ]);

        const data = await client.request<{ ok: boolean }>("/x");

        expect(data.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        // First retry backs off 500 * 2^0 ms.
        expect(sleep).toHaveBeenCalledExactlyOnceWith(500);
    });

    it("stops retrying after maxRetries and surfaces the last status", async () => {
        const { client, fetchMock, sleep } = setup(
            [
                jsonResponse({ message: "Server Error" }, { status: 500 }),
                jsonResponse({ message: "Server Error" }, { status: 500 }),
                jsonResponse({ message: "Server Error" }, { status: 500 }),
            ],
            { maxRetries: 2 },
        );

        const error = await captureError(client.request("/x"));

        expect((error as GitHubError).status).toBe(500);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("honors retry-after on 429", async () => {
        const { client, sleep } = setup([
            jsonResponse({ message: "You have exceeded a secondary rate limit" }, {
                status: 429,
                headers: { "retry-after": "2" },
            }),
            jsonResponse({ ok: true }),
        ]);

        await client.request("/x");

        expect(sleep).toHaveBeenCalledExactlyOnceWith(2000);
    });

    it("backs off when a 403 exhausts the rate limit", async () => {
        const { client, sleep } = setup([
            jsonResponse({ message: "API rate limit exceeded" }, {
                status: 403,
                headers: {
                    "x-ratelimit-limit": "5000",
                    "x-ratelimit-remaining": "0",
                    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
                },
            }),
            jsonResponse({ ok: true }),
        ]);

        await client.request("/x");

        // Reset is far away, so it waits the 30s cap rather than the full hour.
        expect(sleep).toHaveBeenCalledExactlyOnceWith(30_000);
    });

    it("does NOT retry a 403 that is not a rate limit (permission denied)", async () => {
        const { client, fetchMock, sleep } = setup([
            jsonResponse({ message: "Resource not accessible by integration" }, {
                status: 403,
                headers: { "x-ratelimit-remaining": "4999" },
            }),
        ]);

        const error = await captureError(client.request("/x"));

        expect((error as GitHubError).status).toBe(403);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it("retries network failures and then throws a GitHubError", async () => {
        const { client, fetchMock, sleep } = setup(
            [new Error("ECONNRESET"), new Error("ECONNRESET")],
            { maxRetries: 1 },
        );

        const error = await captureError(client.request("/x"));

        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).message).toContain("Network error");
        expect((error as GitHubError).message).toContain("ECONNRESET");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledExactlyOnceWith(500);
    });

    it("aborts on timeout and reports it as a GitHubError", async () => {
        const hangingFetch = ((_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => {
                    reject(new DOMException("The operation was aborted", "AbortError"));
                });
            })) as unknown as typeof fetch;
        const sleep = vi.fn(async () => undefined);

        const client = createGitHubClient({
            token: TOKEN,
            fetchImpl: hangingFetch,
            sleep,
            timeoutMs: 30,
            maxRetries: 1,
        });

        const error = await captureError(client.request("/x"));

        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).message).toContain("timed out after 30ms");
        expect((error as GitHubError).status).toBe(0);
    });

    it("records rate limit headers and merges them across responses", async () => {
        const { client } = setup([
            jsonResponse({ a: 1 }, {
                headers: {
                    "x-ratelimit-limit": "5000",
                    "x-ratelimit-remaining": "4999",
                    "x-ratelimit-reset": "1700000000",
                },
            }),
            jsonResponse({ b: 2 }),
        ]);

        await client.request("/a");
        const first = client.getRateLimit();
        expect(first?.limit).toBe(5000);
        expect(first?.remaining).toBe(4999);
        expect(first?.resetAt).toBeInstanceOf(Date);

        await client.request("/b");
        const second = client.getRateLimit();
        // The second response carried no headers; earlier data must survive.
        expect(second?.limit).toBe(5000);
        expect(second?.remaining).toBe(4999);
    });

    describe("graphql", () => {
        it("POSTs the query with variables to /graphql and returns data", async () => {
            const { client, fetchMock } = setup([
                jsonResponse({ data: { organization: { login: "acme" } } }),
            ]);

            const data = await client.graphql<{ organization: { login: string } }>(
                "query ($login: String!) { organization(login: $login) { login } }",
                { login: "acme" },
            );

            expect(data.organization.login).toBe("acme");
            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
            expect(url).toBe("https://api.github.com/graphql");
            expect(init.method).toBe("POST");
            const body = JSON.parse(init.body) as { query: string; variables: unknown };
            expect(body.query).toContain("organization");
            expect(body.variables).toEqual({ login: "acme" });
        });

        it("throws when the response contains errors", async () => {
            const { client } = setup([
                jsonResponse({ errors: [{ message: "Field 'foo' doesn't exist on type 'Query'" }] }),
            ]);

            const error = await captureError(client.graphql("query { foo }"));

            expect(error).toBeInstanceOf(GitHubError);
            expect((error as GitHubError).message).toContain("Field 'foo' doesn't exist");
        });

        it("maps a NOT_FOUND error to status 404 (GraphQL always returns HTTP 200)", async () => {
            const { client } = setup([
                jsonResponse({
                    data: { organization: null },
                    errors: [
                        {
                            type: "NOT_FOUND",
                            path: ["organization"],
                            message: "Could not resolve to an Organization with the login of 'nope'.",
                        },
                    ],
                }),
            ]);

            const error = await captureError(
                client.graphql("query ($login: String!) { organization(login: $login) { id } }", {
                    login: "nope",
                }),
            );

            expect((error as GitHubError).status).toBe(404);
            expect((error as GitHubError).message).toContain("Could not resolve to an Organization");
        });

        it("maps RATE_LIMITED errors to status 429 with rate limit info", async () => {
            const { client } = setup([
                jsonResponse(
                    { errors: [{ message: "API rate limit exceeded", type: "RATE_LIMITED" }] },
                    { headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0" } },
                ),
            ]);

            const error = await captureError(client.graphql("query { x }"));

            expect((error as GitHubError).status).toBe(429);
            const info: RateLimitInfo | undefined = (error as GitHubError).rateLimit;
            expect(info?.remaining).toBe(0);
        });

        it("throws when data is missing entirely", async () => {
            const { client } = setup([jsonResponse({})]);
            const error = await captureError(client.graphql("query { x }"));
            expect((error as GitHubError).message).toContain("no data");
        });
    });

    describe("error hygiene", () => {
        it("never includes the token in an error message", async () => {
            const { client } = setup([jsonResponse({ message: "Bad credentials" }, { status: 401 })]);

            const error = await captureError(client.request("/user"));

            expect((error as GitHubError).message).not.toContain(TOKEN);
            expect(JSON.stringify((error as GitHubError).rateLimit ?? {})).not.toContain(TOKEN);
        });

        it("does not echo response bodies verbatim (they are only read for .message)", async () => {
            const { client } = setup([
                jsonResponse({ message: "Whatever", secretish: "value" }, { status: 422 }),
            ]);

            const error = await captureError(client.request("/user"));

            expect((error as GitHubError).message).toBe("GitHub API error 422: Whatever");
        });
    });
});
