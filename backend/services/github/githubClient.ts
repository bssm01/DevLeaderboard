import { config } from "../../config/config.js";
import { createGitHubClient } from "./client.js";

/**
 * The shared client used by the leaderboard collectors. Built once at import
 * time from validated config, so a missing GITHUB_TOKEN fails at boot.
 */
export const githubClient = createGitHubClient({
    token: config.GitHub.Token,
    apiUrl: config.GitHub.ApiUrl,
    timeoutMs: config.GitHub.TimeoutMs,
});
