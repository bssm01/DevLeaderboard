// Runs before each test file. Values here take precedence over any local .env
// because config.ts never overrides variables that are already set.
process.env.NODE_ENV ??= "test";
process.env.JWT_SECRET ??= "test-secret-with-enough-length-123456";
process.env.JWT_EXPIRES_MINUTES ??= "60";
process.env.RATE_LIMIT_MAX ??= "1000000";
process.env.RATE_LIMIT_REFRESH_MAX ??= "1000000";
process.env.DATABASE_NAME ??= "devleaderboard_test";
process.env.GITHUB_TOKEN ??= "ghp_dummy_token_for_unit_tests_only";
process.env.SCORE_COMMIT ??= "5";
process.env.SCORE_PR ??= "10";
process.env.SCORE_REVIEW ??= "3";
process.env.SCORE_ISSUE ??= "2";
process.env.LEADERBOARD_CRON ??= "0 */6 * * *";
process.env.LEADERBOARD_ORGS ??= "acme";
// Quiet by default: request/info lines would drown the test reporter.
process.env.LOG_LEVEL ??= "warn";
