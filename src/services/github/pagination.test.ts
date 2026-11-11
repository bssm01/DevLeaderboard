import { describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "./client.js";
import { GitHubError } from "./errors.js";
import { paginateGraphql, parseNextLink } from "./pagination.js";
import type { GraphqlPage } from "./types.js";

const TOKEN = "ghp_unit_test_token";

const jsonResponse = (body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
    });

const collect = async <T>(source: AsyncGenerator<T, void, undefined>): Promise<T[]> => {
    const items: T[] = [];
    for await (const item of source) items.push(item);
    return items;
};

const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error("expected the promise to reject");
};

describe("parseNextLink", () => {
    it("extracts the next URL", () => {
        const header =
            '<https://api.github.com/orgs/acme/repos?page=2&per_page=100>; rel="next", ' +
            '<https://api.github.com/orgs/acme/repos?per_page=100>; rel="last"';

        expect(parseNextLink(header)).toBe("https://api.github.com/orgs/acme/repos?page=2&per_page=100");
    });

    it("returns undefined when there is no next relation", () => {
        const header = '<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first"';
        expect(parseNextLink(header)).toBeUndefined();
    });

    it("returns undefined for a missing header", () => {
        expect(parseNextLink(null)).toBeUndefined();
    });

    it("ignores malformed parts", () => {
        expect(parseNextLink("garbage, <https://api.github.com/x?page=2>; rel=\"next\"")).toBe(
            "https://api.github.com/x?page=2",
        );
    });
});

describe("client.paginateRest", () => {
    const makeClient = (queue: Response[], overrides = {}) =>
        createGitHubClient({
            token: TOKEN,
            fetchImpl: (async () => queue.shift() ?? new Response("{}", { status: 500 })) as unknown as typeof fetch,
            sleep: async () => undefined,
            ...overrides,
        });

    it("follows the Link header and yields every item across pages", async () => {
        const client = makeClient([
            jsonResponse(
                [{ id: 1 }, { id: 2 }],
                { Link: '<https://api.github.com/orgs/acme/repos?page=2>; rel="next"' },
            ),
            jsonResponse([{ id: 3 }, { id: 4 }]),
        ]);

        const items = await collect(client.paginateRest<{ id: number }>("/orgs/acme/repos"));

        expect(items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    });

    it("stops after a single page when there is no next link", async () => {
        const fetchMock = vi.fn(async () => jsonResponse([{ id: 1 }]));
        const client = createGitHubClient({
            token: TOKEN,
            fetchImpl: fetchMock as unknown as typeof fetch,
            sleep: async () => undefined,
        });

        const items = await collect(client.paginateRest<{ id: number }>("/orgs/acme/repos"));

        expect(items).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("is bounded by maxPages and fails loudly instead of truncating", async () => {
        const fetchMock = vi.fn(async () =>
            jsonResponse([{ id: 1 }], { Link: '<https://api.github.com/x?page=2>; rel="next"' }),
        );
        const client = createGitHubClient({
            token: TOKEN,
            fetchImpl: fetchMock as unknown as typeof fetch,
            sleep: async () => undefined,
            maxPages: 3,
        });

        const error = await captureError(collect(client.paginateRest<{ id: number }>("/x")));

        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).message).toContain("3 page limit");
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("rejects a non-array payload instead of yielding garbage", async () => {
        const client = makeClient([jsonResponse({ message: "Not Found" })]);

        const error = await captureError(collect(client.paginateRest("/x")));

        expect((error as GitHubError).message).toContain("Expected a JSON array");
    });
});

describe("paginateGraphql", () => {
    const page = (
        items: number[],
        hasNextPage: boolean,
        endCursor: string | null,
    ): GraphqlPage<number> => ({ items, pageInfo: { hasNextPage, endCursor } });

    it("walks cursors to completion", async () => {
        const fetchPage = vi
            .fn<(cursor: string | null) => Promise<GraphqlPage<number>>>()
            .mockResolvedValueOnce(page([1, 2], true, "cursor-1"))
            .mockResolvedValueOnce(page([3], false, null));

        const items = await collect(paginateGraphql(fetchPage));

        expect(items).toEqual([1, 2, 3]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(fetchPage).toHaveBeenNthCalledWith(1, null);
        expect(fetchPage).toHaveBeenNthCalledWith(2, "cursor-1");
    });

    it("returns immediately for an empty connection", async () => {
        const fetchPage = vi.fn<(cursor: string | null) => Promise<GraphqlPage<number>>>().mockResolvedValue(
            page([], false, null),
        );

        expect(await collect(paginateGraphql(fetchPage))).toEqual([]);
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it("throws when hasNextPage is true but the cursor does not advance", async () => {
        const fetchPage = vi
            .fn<(cursor: string | null) => Promise<GraphqlPage<number>>>()
            .mockResolvedValue(page([1], true, null));

        const error = await captureError(collect(paginateGraphql(fetchPage)));

        expect((error as GitHubError).message).toContain("cursor did not advance");
        expect(fetchPage).toHaveBeenCalledTimes(1);
    });

    it("throws when the same cursor comes back twice", async () => {
        const fetchPage = vi
            .fn<(cursor: string | null) => Promise<GraphqlPage<number>>>()
            .mockResolvedValueOnce(page([1], true, "c1"))
            .mockResolvedValue(page([2], true, "c1"));

        const error = await captureError(collect(paginateGraphql(fetchPage)));

        expect((error as GitHubError).message).toContain("cursor did not advance");
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    it("is bounded by maxPages", async () => {
        const fetchPage = vi
            .fn<(cursor: string | null) => Promise<GraphqlPage<number>>>()
            .mockImplementation(async (cursor) => page([1], true, `cursor-${Number(cursor?.split("-")[1] ?? 0) + 1}`));

        const error = await captureError(collect(paginateGraphql(fetchPage, { maxPages: 2 })));

        expect((error as GitHubError).message).toContain("2 page limit");
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });
});
