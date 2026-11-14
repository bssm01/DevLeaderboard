import { GitHubError } from "./errors.js";
import type { GraphqlPage } from "./types.js";

const DEFAULT_MAX_PAGES = 100;

/**
 * Extracts the `rel="next"` URL from a Link header.
 * Example: `<https://api.github.com/x?page=2>; rel="next", <...>; rel="last"`
 */
export const parseNextLink = (header: string | null): string | undefined => {
    if (header === null) return undefined;

    for (const part of header.split(",")) {
        const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
        if (match === null) continue;

        const url = match[1];
        const relations = match[2].split(/\s+/);
        if (relations.includes("next")) return url;
    }

    return undefined;
};

interface PaginateOptions {
    maxPages?: number;
}

/** Materializes a paginated generator into an array. */
export const drain = async <T>(source: AsyncGenerator<T, void, undefined>): Promise<T[]> => {
    const items: T[] = [];
    for await (const item of source) items.push(item);
    return items;
};

/**
 * Walks a cursor-based GraphQL connection to completion.
 *
 * Two guards keep a buggy or hostile response from looping forever:
 *  - a hard `maxPages` bound,
 *  - a cursor that must strictly advance on every page.
 */
export async function* paginateGraphql<T>(
    fetchPage: (cursor: string | null) => Promise<GraphqlPage<T>>,
    options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    let cursor: string | null = null;
    let pages = 0;

    for (;;) {
        if (pages >= maxPages) {
            throw new GitHubError(`GraphQL pagination exceeded the ${maxPages} page limit`, 0);
        }

        const page = await fetchPage(cursor);
        pages += 1;
        yield* page.items;

        if (!page.pageInfo.hasNextPage) return;

        const next = page.pageInfo.endCursor;
        if (next === null || next === cursor) {
            throw new GitHubError("GraphQL pagination cursor did not advance", 0);
        }
        cursor = next;
    }
}
