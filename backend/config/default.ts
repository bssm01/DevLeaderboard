export const defaults = {
    DATABASE_HOST: "localhost",
    DATABASE_PORT: 27017,
    DATABASE_SCHEME: "mongodb",
    DATABASE_USER: "",
    DATABASE_PASSWORD: "",
    DATABASE_NAME: "devleaderboard",
    PORT: 3000,
    RATE_LIMIT_REFRESH_WINDOW_MS: 15 * 60 * 1000,
    RATE_LIMIT_REFRESH_MAX: 10,
    GITHUB_API_URL: "https://api.github.com",
    GITHUB_TIMEOUT_MS: 15000,
    SCORE_COMMIT: 5,
    SCORE_PR: 10,
    SCORE_REVIEW: 3,
    SCORE_ISSUE: 2,
    LEADERBOARD_CRON: "0 */6 * * *",
    // The org the site opens on. Override with LEADERBOARD_ORGS, or set it to
    // an empty string to disable the scheduler.
    LEADERBOARD_ORGS: "MicroClub-USTHB",
    // External projects, written as `org=owner/repo`. Opt-in only: the board
    // counts organization repositories exclusively unless this is set.
    LEADERBOARD_EXTRA_REPOS: "",
    LOG_LEVEL: "info",
    // Reuse the Dev list from MCID for ten minutes.
    MCID_ROSTER_TTL_MS: 10 * 60 * 1000,
} as const;
