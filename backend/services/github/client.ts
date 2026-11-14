import { GitHubError } from "./errors.js";
import { parseNextLink } from "./pagination.js";
import type {
    GitHubClient,
    GitHubRequestOptions,
    RateLimitInfo,
    RestClientOptions,
} from "./types.js";

const API_VERSION = "2022-11-28";
const USER_AGENT = "wawachi-leaderboard";
const ACCEPT_JSON = "application/vnd.github+json";

/** Statuses worth retrying regardless of rate-limit state. */
const RETRIABLE_STATUS = new Set([500, 502, 503, 504, 429]);
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_API_URL = "https://api.github.com";

interface GraphqlErrorShape {
    message?: string;
    type?: string;
}

const parseRateLimitHeaders = (headers: Headers): RateLimitInfo => {
    const info: RateLimitInfo = {};

    const limit = Number(headers.get("x-ratelimit-limit"));
    if (headers.get("x-ratelimit-limit") !== null && Number.isFinite(limit)) info.limit = limit;

    const remaining = Number(headers.get("x-ratelimit-remaining"));
    if (headers.get("x-ratelimit-remaining") !== null && Number.isFinite(remaining)) {
        info.remaining = remaining;
    }

    const cost = Number(headers.get("x-ratelimit-cost"));
    if (headers.get("x-ratelimit-cost") !== null && Number.isFinite(cost)) info.cost = cost;

    const resource = headers.get("x-ratelimit-resource");
    if (resource !== null) info.resource = resource;

    const reset = headers.get("x-ratelimit-reset");
    if (reset !== null && Number.isFinite(Number(reset))) info.resetAt = new Date(Number(reset) * 1000);

    return info;
};

const readJson = async <T>(response: Response): Promise<T> => {
    const text = await response.text();
    if (text.length === 0) return undefined as T;

    try {
        return JSON.parse(text) as T;
    } catch {
        throw new GitHubError("GitHub returned a non-JSON response", response.status);
    }
};

const readErrorMessage = async (response: Response): Promise<string> => {
    try {
        const text = await response.text();
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.length > 0) {
            return `GitHub API error ${response.status}: ${parsed.message}`;
        }
    } catch {
        // Body missing or not JSON; the status alone is the best message we have.
    }
    return `GitHub API error ${response.status}`;
};

export const createGitHubClient = (options: RestClientOptions): GitHubClient => {
    const { token } = options;
    if (!token) throw new Error("createGitHubClient: a token is required");

    const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep =
        options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    // Last known budget; merged (never wiped) because some responses omit headers.
    let rateLimit: RateLimitInfo | undefined;

    const buildHeaders = (): Record<string, string> => ({
        Authorization: `Bearer ${token}`,
        Accept: ACCEPT_JSON,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": API_VERSION,
    });

    const toAbsoluteUrl = (path: string): string =>
        path.startsWith("http://") || path.startsWith("https://") ? path : `${apiUrl}${path}`;

    const recordRateLimit = (headers: Headers): void => {
        rateLimit = { ...rateLimit, ...parseRateLimitHeaders(headers) };
    };

    const fetchWithTimeout = async (url: string, method: string, body?: string): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetchImpl(url, {
                method,
                headers: buildHeaders(),
                body,
                signal: controller.signal,
            });
        } catch (error) {
            if (controller.signal.aborted) {
                throw new GitHubError(`GitHub request timed out after ${timeoutMs}ms`, 0);
            }
            const detail = error instanceof Error ? error.message : String(error);
            throw new GitHubError(`Network error contacting GitHub: ${detail}`, 0);
        } finally {
            clearTimeout(timer);
        }
    };

    /** Honors retry-after / rate-limit reset, otherwise exponential backoff with a cap. */
    const computeDelay = (headers: Headers | null, attempt: number): number => {
        if (headers !== null) {
            const retryAfter = headers.get("retry-after");
            if (retryAfter !== null) {
                const seconds = Number(retryAfter);
                if (Number.isFinite(seconds) && seconds >= 0) {
                    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
                }
            }

            if (rateLimit?.remaining === 0 && rateLimit.resetAt instanceof Date) {
                const waitMs = rateLimit.resetAt.getTime() - Date.now() + 1000;
                if (waitMs > 0) return Math.min(waitMs, MAX_BACKOFF_MS);
            }
        }

        return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
    };

    const rawRequest = async (url: string, requestOptions: GitHubRequestOptions): Promise<Response> => {
        const method = requestOptions.method ?? "GET";
        let attempt = 0;

        for (;;) {
            let response: Response;

            try {
                response = await fetchWithTimeout(url, method, requestOptions.body);
            } catch (error) {
                // status 0 = network failure or timeout; both are worth retrying.
                if (error instanceof GitHubError && error.status === 0 && attempt < maxRetries) {
                    await sleep(computeDelay(null, attempt));
                    attempt += 1;
                    continue;
                }
                throw error;
            }

            recordRateLimit(response.headers);

            if (response.ok) return response;

            const status = response.status;
            const rateLimited =
                status === 429 ||
                (status === 403 &&
                    (rateLimit?.remaining === 0 || response.headers.has("retry-after")));
            const retriable = RETRIABLE_STATUS.has(status) || rateLimited;

            if (retriable && attempt < maxRetries) {
                // Drain the body so the connection can be reused, then back off.
                await response.body?.cancel().catch(() => undefined);
                await sleep(computeDelay(response.headers, attempt));
                attempt += 1;
                continue;
            }

            const message = await readErrorMessage(response);
            throw new GitHubError(message, status, rateLimit);
        }
    };

    const graphql = async <T>(
        query: string,
        variables?: Record<string, unknown>,
    ): Promise<T> => {
        const response = await rawRequest(`${apiUrl}/graphql`, {
            method: "POST",
            body: JSON.stringify({ query, variables }),
        });

        const payload = await readJson<{ data?: T | null; errors?: GraphqlErrorShape[] }>(response);

        if (payload === undefined || payload === null) {
            throw new GitHubError("GitHub GraphQL returned an empty response", response.status, rateLimit);
        }

        if (payload.errors !== undefined && payload.errors.length > 0) {
            const first = payload.errors[0];
            const message = first?.message ?? "Unknown error";
            // GraphQL always answers HTTP 200, so the error `type` carries the
            // real outcome: rate-limited -> 429, missing resource -> 404.
            const status =
                first?.type === "RATE_LIMITED" ? 429 : first?.type === "NOT_FOUND" ? 404 : 0;
            throw new GitHubError(`GitHub GraphQL error: ${message}`, status, rateLimit);
        }

        if (payload.data === undefined || payload.data === null) {
            throw new GitHubError("GitHub GraphQL returned no data", response.status, rateLimit);
        }

        return payload.data;
    };

    async function* paginateRest<T>(path: string): AsyncGenerator<T, void, undefined> {
        let url: string | undefined = toAbsoluteUrl(path);
        let pages = 0;

        while (url !== undefined) {
            if (pages >= maxPages) {
                throw new GitHubError(`Pagination exceeded the ${maxPages} page limit`, 0, rateLimit);
            }

            const response = await rawRequest(url, { method: "GET" });
            pages += 1;

            const items = await readJson<unknown>(response);
            if (!Array.isArray(items)) {
                throw new GitHubError(`Expected a JSON array from ${url}`, response.status, rateLimit);
            }

            yield* items as T[];

            url = parseNextLink(response.headers.get("link"));
        }
    }

    return {
        graphql,
        paginateRest,
        getRateLimit: () => (rateLimit === undefined ? undefined : { ...rateLimit }),
    };
};
