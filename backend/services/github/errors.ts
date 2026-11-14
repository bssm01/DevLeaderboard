import type { RateLimitInfo } from "./types.js";

export class GitHubError extends Error {
    readonly status: number;
    readonly rateLimit?: RateLimitInfo;

    constructor(message: string, status: number, rateLimit?: RateLimitInfo) {
        super(message);
        this.name = "GitHubError";
        this.status = status;
        this.rateLimit = rateLimit;
    }
}
