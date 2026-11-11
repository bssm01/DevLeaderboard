# DevLeaderboard

A GitHub organization leaderboard API. It collects contribution activity for every member of an
organization across **all of its repositories**, ranks them with a composite score, caches the
result in MongoDB, and serves it over a small HTTP API — so the read path never talks to GitHub.

- **Stack:** Express 5 · TypeScript (ESM) · Mongoose · Vitest
- **Data source:** GitHub GraphQL API (members + contributions) with a REST fallback for outside
  collaborators
- **Refresh model:** scheduled (cron) + manual refresh → Mongo cache → cheap reads with ETag/304

---

## Quick start

```bash
npm install
cp .env.example .env        # then fill in JWT_SECRET and GITHUB_TOKEN
npm run dev                 # http://localhost:3000
```

Requirements:

- **Node 22+** (the project uses `import.meta.dirname` and native `fetch`)
- **MongoDB** running locally (or point `DATABASE_*` at a remote instance)
- A **GitHub PAT** with `repo` + `read:org` scopes (classic) — required at boot; the token
  works for both public and private repositories

Configuration is validated with zod at startup: the process refuses to boot with a missing
`JWT_SECRET` (< 16 chars), a missing `GITHUB_TOKEN`, an invalid `LEADERBOARD_CRON` expression,
or an unknown `LOG_LEVEL`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_HOST` | `localhost` | MongoDB host |
| `DATABASE_PORT` | `27017` | MongoDB port |
| `DATABASE_USER` / `DATABASE_PASSWORD` | *(empty)* | Leave empty for a local unauthenticated MongoDB |
| `DATABASE_NAME` | `devleaderboard` | Database name |
| `JWT_SECRET` | — | **Required**, min 16 chars (use 32+ random chars in production) |
| `JWT_EXPIRES_MINUTES` | `60` | Access-token lifetime |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Window for the `/auth` bucket |
| `RATE_LIMIT_MAX` | `100` | Requests per window for `/auth` |
| `RATE_LIMIT_REFRESH_WINDOW_MS` | `900000` | Window for the refresh bucket |
| `RATE_LIMIT_REFRESH_MAX` | `10` | Refreshes per window (refreshes spend GitHub quota) |
| `GITHUB_TOKEN` | — | **Required** PAT; scopes `repo` + `read:org` |
| `GITHUB_API_URL` | `https://api.github.com` | Override for GitHub Enterprise / failure drills |
| `GITHUB_TIMEOUT_MS` | `15000` | Per-request timeout to GitHub |
| `SCORE_COMMIT` | `5` | Score weight per commit |
| `SCORE_PR` | `10` | Score weight per merged PR |
| `SCORE_REVIEW` | `3` | Score weight per PR review |
| `SCORE_ISSUE` | `2` | Score weight per issue opened |
| `LEADERBOARD_CRON` | `0 */6 * * *` | 5-field cron expression (server timezone) |
| `LEADERBOARD_ORGS` | *(empty)* | Comma-separated org logins to refresh automatically. Empty = scheduler off (manual refresh still works for any org) |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` — one JSON object per line |

---

## Scoring

Each contributor's score is a weighted composite:

```
score = SCORE_COMMIT * commits
      + SCORE_PR     * mergedPullRequests
      + SCORE_REVIEW * reviews
      + SCORE_ISSUE  * issues
```

- Ranks are assigned by `score` descending; ties are broken deterministically.
- **Bots are filtered out** (GitHub `[bot]` suffixes, `-bot` login suffixes, and a denylist).
- Contributors are keyed by GitHub **node id** and deduplicated by lowercase login, so members
  and outside collaborators never double-count.

### Periods

| `period` | Window |
|---|---|
| `7d` | last 7 days |
| `30d` | last 30 days (default) |
| `year` | last 364 days |

Snapshots are unique per `{ org (lowercased), period }`.

---

## API reference

All responses are JSON. Errors use `{ "error": "..." }`.

### Auth endpoints

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| `POST` | `/auth/register` | — | `201` `{ user, token }` | `400` validation, `409` duplicate email |
| `POST` | `/auth/login` | — | `200` `{ user, token }` | `400` validation, `401` bad credentials |

### Leaderboard endpoints

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| `GET` | `/leaderboard/:org` | — | `200` snapshot, or `304` (ETag) | `400` bad `org`/`period`/`limit` |
| `GET` | `/leaderboard/:org/meta` | — | `200` weights + quota + snapshot freshness | `400` bad `org` |
| `POST` | `/leaderboard/:org/refresh` | Bearer JWT | `200` per-period results | `401` no/bad token, `400` bad input, `404` org not on GitHub, `429`/`503` GitHub rate-limited, `502` GitHub failed |
| `GET` | `/health` | — | `200` `{ status: "ok" }` | — |

**`GET /leaderboard/:org`** — reads only from Mongo (never calls GitHub).

Query params:

- `period` — `7d` \| `30d` (default) \| `year`
- `limit` — `1..100` (default `50`)

```jsonc
// 200
{
  "org": "acme",
  "period": "30d",
  "generatedAt": "2026-11-11T13:54:04.000Z",
  "windowFrom": "2026-10-12T13:54:04.000Z",
  "windowTo": "2026-11-11T13:54:04.000Z",
  "total": 42,
  "count": 42,
  "warnings": [],
  "entries": [
    { "key": "MDQ6VXNlcjE=", "login": "bassem", "avatarUrl": "...",
      "commits": 120, "pullRequests": 18, "reviews": 40, "issues": 3,
      "score": 1274, "rank": 1 }
  ]
}
```

- **`202`** when no snapshot exists yet: `{ "org", "period", "message" }`. Not an error —
  the schedule simply hasn't produced one. Trigger a refresh or wait for the cron run.
- **`ETag` / `304`:** every `200` carries a weak ETag derived from `generatedAt`, contributor
  count and `limit`. Send it back as `If-None-Match` to get a bodyless `304`.

**`GET /leaderboard/:org/meta`**

```jsonc
{
  "org": "acme",
  "scoreWeights": { "Commit": 5, "PullRequest": 10, "Review": 3, "Issue": 2 },
  "rateLimit": { "limit": 5000, "remaining": 4990, "resource": "graphql",
                 "resetAt": "2026-11-11T15:00:00.000Z" },   // null before any GitHub call
  "snapshots": [
    { "period": "7d",  "generatedAt": "...", "entryCount": 30 },
    { "period": "30d", "generatedAt": "...", "entryCount": 42 },
    { "period": "year","generatedAt": "...", "entryCount": 55 }
  ]
}
```

**`POST /leaderboard/:org/refresh`** — requires `Authorization: Bearer <jwt>`.

- Omit `?period` to refresh **all three** periods (sequentially).
- `?period=7d` refreshes only that period.
- Spends GitHub quota, so it has its own tighter rate-limit bucket
  (`RATE_LIMIT_REFRESH_*`).

GitHub failures are mapped and never surface as `500` from this endpoint:

| Upstream | Response |
|---|---|
| Org doesn't exist | `404` |
| Rate limited (HTTP 429, or 403 with quota exhausted) | `503` + `Retry-After` when GitHub sent a reset time |
| Bad/insufficient token (401/403) | `502` |
| Network failure / GitHub 5xx | `502` |

### Scheduling

- `LEADERBOARD_CRON` (default every 6 hours) refreshes every org in `LEADERBOARD_ORGS`.
- Runs are **sequential** with overlap protection (`noOverlap`), and the timer is `unref`'d so
  it never keeps the process alive.
- **Empty `LEADERBOARD_ORGS` disables the scheduler** (logged as a warning at boot); manual
  refresh still works for any org.
- A failure in one org or period is logged and swallowed — the read path keeps serving the
  previous snapshot either way.

### Failure behavior (by design)

The read path has **no dependency on GitHub**. If GitHub is unreachable, rate-limited, or
returning errors:

- `GET /leaderboard/:org` keeps serving the last cached snapshot (`200`, same ETag),
- `POST .../refresh` fails as an upstream error (`502`/`503`), not a crash.

This is verified by an HTTP-level failure drill (server restarted with a dead
`GITHUB_API_URL`): reads stayed `200`, refresh returned `502`, and the snapshot was
byte-for-byte unchanged.

---

## Architecture

```
routes/        Express routers (input surface, rate-limit buckets, auth middleware)
  └── controllers/   HTTP semantics: validation, status codes, ETag, GitHub→HTTP error mapping
        └── services/
              ├── leaderboard/   collector → aggregator → sync (single-flight writes)
              └── github/        typed REST/GraphQL client (timeout, backoff, rate-limit merge)
        └── models/       Mongoose schemas (User, LeaderboardSnapshot)
jobs/          node-cron scheduler
middleware/    auth (requireAuth), request logging, error handling
lib/           structured JSON logger (level filtering + credential redaction)
config/        zod-validated config, fail-fast at boot
```

Key decisions:

- **Layered:** routes → controllers → services → models. Controllers never touch GitHub
  directly; services never know about Express.
- **ESM** with `.js` import suffixes; type-only imports use `import type`.
- **Single-flight sync:** concurrent refreshes for the same `{org, period}` coalesce into one
  GitHub collection run.
- **GraphQL batching:** members come from `membersWithRole`, contributions from
  `contributionsCollection(organizationID:…)` with 10 logins per request — variables only,
  never string-interpolated. Outside collaborators come from REST
  `/orgs/{org}/outside_collaborators` (the GraphQL field does not exist); a `403` there
  degrades to a warning instead of failing the run.
- **Security:** helmet, rate limiting, bcrypt hashing with a constant-time placeholder
  (no account enumeration), generic 401s, credential redaction in logs, query strings never
  logged (they may carry secrets).

### Logging

One JSON object per line:

```json
{"method":"POST","path":"/leaderboard/honojs/refresh","status":502,"durationMs":3552.8,"time":"2026-11-11T13:54:40.030Z","level":"info","msg":"request"}
```

Envelope fields (`time`, `level`, `msg`) are written last so caller fields can't forge them,
and any key matching `token|secret|password|authorization|credential|cookie|api key` is
redacted automatically. The logger never throws (unserializable fields degrade to a note).

---

## Testing

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run — 211 tests
npm run build       # tsc -p tsconfig.build.json
```

- **211 unit/integration tests** across config, logger, auth, GitHub client, aggregator,
  collector, sync, controller, routes, cron and middleware.
- Route tests run against the real Express app with models mocked; `LOG_LEVEL=warn` in the
  test environment keeps the reporter clean.
- Live smoke/failure-drill scripts (run manually against a real server + real GitHub) verified
  the full refresh → cache → ETag/304 path and the degraded-mode guarantees above.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with watch (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Strict type check |
| `npm test` / `npm run test:watch` | Run / watch tests |

---

## Project history

Built phase by phase, each gated on typecheck + tests + review before moving on:

- **Phase 0 — foundations:** password-hash leak fix, fail-fast config, JWT secret handling,
  centralized error middleware, helmet + rate limiting, app/server split with graceful
  shutdown, vitest + supertest, strict tsconfig.
- **Phase 1 — GitHub client:** auth headers, timeouts, capped backoff honoring
  `retry-after`/`reset`, non-retryable permission 403s, rate-limit header merging, bounded
  pagination, no token leakage in errors.
- **Phase 2 — collection & scoring:** periods, pure aggregator, member/outside-collaborator
  collector, snapshot model, single-flight sync.
- **Phase 3 — API & scheduling:** `requireAuth`, leaderboard controller (ETag/304, 202 while
  empty, GitHub→HTTP error mapping), routes with a dedicated refresh rate-limit bucket,
  cron job with overlap protection, graceful shutdown wiring.
- **Phase 4 — hardening:** structured JSON logger with redaction, per-request access log,
  stale-serving failure drills (HTTP-level proof that reads never depend on GitHub), full docs.
