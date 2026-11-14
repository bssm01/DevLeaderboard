import type { ErrorBody, ValidationIssue } from "./types";

/**
 * Every request goes through here so the rest of the app only ever deals
 * with a single, typed failure mode instead of `Response` objects.
 */

const BASE_URL = "/api";

/**
 * ETag cache for GETs that opt in. Keyed by full path; stores the validator
 * and the parsed body so a 304 can be answered locally without a body.
 */
interface ETagEntry {
    etag: string;
    body: unknown;
}
const etagCache = new Map<string, ETagEntry>();

export class ApiError extends Error {
    readonly status: number;
    readonly issues: readonly ValidationIssue[];

    /** Seconds until the caller may retry, taken from `Retry-After`. */
    readonly retryAfterSeconds: number | null;

    constructor(
        status: number,
        message: string,
        issues: readonly ValidationIssue[] = [],
        retryAfterSeconds: number | null = null,
    ) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.issues = issues;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/** True when the user must sign in again (401 from the API). */
export const isAuthError = (error: unknown): error is ApiError =>
    error instanceof ApiError && error.status === 401;

const readRetryAfter = (response: Response): number | null => {
    const header = response.headers.get("retry-after");
    if (header === null) return null;

    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

    // HTTP-date form
    const date = Date.parse(header);
    if (Number.isNaN(date)) return null;
    return Math.max(1, Math.ceil((date - Date.now()) / 1000));
};

/** Fallback messages per status so users never see a raw "502". */
const fallbackMessage = (status: number): string => {
    switch (status) {
        case 401:
            return "Please sign in to continue.";
        case 404:
            return "Not found.";
        case 429:
            return "Too many requests. Please wait a moment and try again.";
        case 502:
        case 503:
            return "GitHub is unavailable right now. Showing the last snapshot.";
        default:
            return status >= 500 ? "Something went wrong on our side." : "Request failed.";
    }
};

const toApiError = async (response: Response): Promise<ApiError> => {
    let body: ErrorBody | null = null;
    try {
        body = (await response.json()) as ErrorBody;
    } catch {
        // Non-JSON error body; the status alone carries the meaning.
    }

    const message =
        typeof body?.error === "string" && body.error.length > 0
            ? body.error
            : fallbackMessage(response.status);

    const issues = Array.isArray(body?.details) ? body.details : [];
    return new ApiError(response.status, message, issues, readRetryAfter(response));
};

export interface RequestOptions {
    method?: "GET" | "POST";
    body?: unknown;
    /** Sent as `Authorization: Bearer <token>` — refresh only. */
    token?: string;
    signal?: AbortSignal;
    /**
     * Sends `If-None-Match` and answers a 304 from the local copy.
     * Only meaningful for idempotent GETs of cacheable resources.
     */
    etag?: boolean;
}

export const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
    const { method = "GET", body, token, signal, etag = false } = options;

    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);

    const cached = etag ? etagCache.get(path) : undefined;
    if (cached !== undefined) headers.set("If-None-Match", cached.etag);

    let response: Response;
    try {
        response = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
    } catch {
        // fetch only rejects on network failure / abort — never on HTTP status.
        throw new ApiError(0, "Can't reach the server. Check your connection.");
    }

    // Unchanged resource: 304 carries no body, so replay the one we have.
    if (response.status === 304 && cached !== undefined) {
        return cached.body as T;
    }

    if (!response.ok) throw await toApiError(response);

    // 204 and other bodyless successes
    if (response.status === 204) return undefined as T;

    const parsed = (await response.json()) as T;

    if (etag) {
        const validator = response.headers.get("etag");
        if (validator !== null) etagCache.set(path, { etag: validator, body: parsed });
    }

    return parsed;
};
