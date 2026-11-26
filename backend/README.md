# DevLeaderboard — backend

A GitHub organization leaderboard API. It collects contribution activity for every contributor of
an organization across **all of its repositories**, ranks them with a composite score, caches the
result in MongoDB, and serves it over a small HTTP API — so the read path never talks to GitHub.

- **Stack:** Express 5 · TypeScript (ESM) · Mongoose
- **Data source:** GitHub GraphQL API (contributions) with REST for member discovery and outside
  collaborators
- **Refresh model:** scheduled (cron) + public manual refresh → Mongo cache → cheap reads with
  ETag/304
- **Default organization:** `MicroClub-USTHB`, refreshed at boot

---

## Quick start

```bash
cd backend
npm install
cp .env.example .env        # then fill in GITHUB_TOKEN
npm run dev                 # http://localhost:3000
```

Requirements:

- **Node 22+** (the project uses `import.meta.dirname` and native `fetch`)
- **MongoDB** — either a local instance (default) or **MongoDB Atlas** via `DATABASE_URL`
- A **GitHub PAT** — required at boot.

### GitHub token

- **Classic PAT** with `repo` + `read:org` + `read:user`: full member list, private repositories,
  and private contributions. GitHub only includes private/internal activity in
  `contributionsCollection` when the token has the `read:user` scope.
- **Fine-grained PAT**: also supported. When it cannot read organization membership, the collector
  falls back to the **public member list plus the contributors of every visible repository**.
  Private repositories are included when the token is granted access to them. Because fine-grained
  tokens have no `read:user` scope, the collector reads visible private repositories directly
  (all branches, PRs, reviews, issues) instead of relying on the contribution graph.

**Collection scope.** Every visible repository is scanned, forks included, and every branch is
read. Commits are deduplicated by SHA across branches and repositories. PRs count when they were
opened or closed/merged in the window; reviews count once per person per PR; issues count when they
were opened or solved in the window (the opener and closer can both receive credit). This goes
beyond GitHub's contribution graph, which only counts default-branch/`gh-pages` commits, PRs opened,
issues opened, and (with `read:user`) private activity.

**Private contributions.** A leaderboard can only rank activity the token can see. If a contributor
works in a private repository the token cannot access, they will not appear. Grant the token access
to those repositories (fine-grained: *Contents: Read*, *Metadata: Read*, *Pull requests: Read*,
*Issues: Read*), or use a classic PAT with `repo` + `read:user`.

**External projects (opt-in).** The board counts only organization repositories by default. If club
work lives outside the organization, it can be added with `LEADERBOARD_EXTRA_REPOS=org=owner/repo`
(comma-separated for several); the default is empty. The repository is resolved through GraphQL,
marked external, and scanned in full: every branch, PR, review and issue is counted directly because
`contributionsCollection(organizationID:)` never includes it. Commit SHAs already seen in an
organization repository are skipped, so a fork or mirror cannot double-count history. External
activity is merged only for accounts that also contributed in the organization during the same
window, so the project owner or a passer-by cannot enter the board through the external repo alone.

Configuration is validated with zod at startup: the process refuses to boot with a missing
`GITHUB_TOKEN`, an invalid `LEADERBOARD_CRON` expression, half-configured database credentials, or
an unknown `LOG_LEVEL`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | — | Full connection string; **wins over everything below** when set |
| `DATABASE_HOST` | `localhost` | MongoDB host (Atlas: `cluster0.xxxxx.mongodb.net`) |
| `DATABASE_PORT` | `27017` | MongoDB port (**ignored** when the scheme is `mongodb+srv`) |
| `DATABASE_SCHEME` | `mongodb` | `mongodb` or `mongodb+srv` — Atlas requires `mongodb+srv` |
| `DATABASE_USER` / `DATABASE_PASSWORD` | *(empty)* | Must be set together; both empty = local unauthenticated MongoDB |
| `DATABASE_NAME` | `devleaderboard` | Database name |
| `RATE_LIMIT_REFRESH_WINDOW_MS` | `900000` | Window for the refresh bucket |
| `RATE_LIMIT_REFRESH_MAX` | `10` | Refreshes per window (refreshes spend GitHub quota) |
| `GITHUB_TOKEN` | — | **Required** PAT |
| `GITHUB_API_URL` | `https://api.github.com` | Override for GitHub Enterprise / failure drills |
| `GITHUB_TIMEOUT_MS` | `15000` | Per-request timeout to GitHub |
| `SCORE_COMMIT` | `5` | Score weight per unique commit |
| `SCORE_PR` | `10` | Score weight per PR opened or closed/merged in the window |
| `SCORE_REVIEW` | `3` | Score weight per PR review (once per person per PR) |
| `SCORE_ISSUE` | `2` | Score weight per issue opened or solved in the window |
| `LEADERBOARD_CRON` | `0 */6 * * *` | 5-field cron expression (server timezone) |
| `LEADERBOARD_ORGS` | `MicroClub-USTHB` | Comma-separated org logins to refresh automatically. Empty = scheduler off |
| `LEADERBOARD_EXTRA_REPOS` | *(empty)* | Optional external projects per org, as `org=owner/repo` (comma-separated). Empty = org-only |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` — one JSON object per line |

---

## Scoring

Each contributor's score is a weighted composite:

```
score = SCORE_COMMIT * commits
      + SCORE_PR     * pullRequests
      + SCORE_REVIEW * reviews
      + SCORE_ISSUE  * issues
```

- Ranks are assigned by `score` descending; ties are broken deterministically.
- **Bots are filtered out** (GitHub `[bot]` suffixes, `-bot` login suffixes, and a denylist).
- Contributors are keyed by GitHub **node id** and deduplicated by lowercase login, so members,
  outside collaborators and repository contributors never double-count.
- Contributors with **zero activity** in the selected window are not ranked.

### Periods

| `period` | Window |
|---|---|
| `month` | 1st of the current month, 00:00 UTC → now |
| `all` | organization creation date → now |
| `custom` | `from` → `to` (UTC day boundaries), at most 366 days, `to` not in the future |

Multi-year windows are split into chunks of at most **364 days** because GitHub's
`contributionsCollection` rejects ranges longer than one year; the chunks are summed per
contributor.

### Snapshot keys and caching

A snapshot is unique per `{ org (lowercased), period, rangeKey }`:

- `rangeKey = ""` for `month` and `all`
- `rangeKey = "YYYY-MM-DD_YYYY-MM-DD"` for a custom range

A non-forced refresh serves a cached snapshot while it is fresh:

| Period | Freshness |
|---|---|
| `month` | 60 seconds |
| `all` | 24 hours |
| `custom` | 24 hours |

`force=1` (what the UI's **Refresh** button sends) bypasses the cache and always recomputes.
Concurrent refreshes for the same key coalesce into a single GitHub run.

---

## API reference

All responses are JSON. Errors use `{ "error": "..." }`. There is no authentication.

| Method | Path | Description |
|---|---|---|
| `GET` | `/leaderboard/:org` | Snapshot from Mongo, or `304` with a matching ETag |
| `GET` | `/leaderboard/:org/meta` | Weights, quota, organization creation date, snapshot freshness |
| `POST` | `/leaderboard/:org/refresh` | Refresh one period, or `month` + `all` when `period` is omitted |
| `GET` | `/health` | `{ "status": "ok" }` |

### `GET /leaderboard/:org`

Query params:

- `period` — `month` (default) \| `all` \| `custom`
- `from`, `to` — required for `custom`; `YYYY-MM-DD`
- `limit` — `1..100` (default `50`)
- `offset` — number of ranked contributors to skip (default `0`), for pagination

```jsonc
// 200
{
  "org": "microclub-usthb",
  "period": "month",
  "rangeKey": "",
  "generatedAt": "2026-11-22T17:21:14.693Z",
  "windowFrom": "2026-11-01T00:00:00.000Z",
  "windowTo": "2026-11-22T17:21:14.693Z",
  "total": 12,
  "count": 12,
  "warnings": [],
  "entries": [
    { "key": "MDQ6VXNlcjUxMjM5NjU2", "login": "Adel2411", "avatarUrl": "...",
      "commits": 119, "pullRequests": 29, "reviews": 4, "issues": 3,
      "score": 903, "rank": 1 }
  ]
}
```

- **`202`** when no snapshot exists yet: `{ "org", "period", "rangeKey", "message" }`. Not an error —
  the client can trigger a refresh or wait for the cron run.
- **`400`** for an invalid `org`, `period`, `limit`, `offset`, or custom range (missing dates, `from > to`,
  future `to`, more than 366 days).
- **`ETag` / `304`:** every `200` carries a weak ETag derived from `generatedAt`, contributor
  count, `limit`, `offset` and `rangeKey`. Send it back as `If-None-Match` to get a bodyless `304`.

### `GET /leaderboard/:org/meta`

```jsonc
{
  "org": "microclub-usthb",
  "orgCreatedAt": "2018-10-13T21:55:27.000Z",
  "scoreWeights": { "Commit": 5, "PullRequest": 10, "Review": 3, "Issue": 2 },
  "rateLimit": { "limit": 5000, "remaining": 4734, "resource": "graphql",
                 "resetAt": "2026-11-22T18:00:00.000Z" },   // null before any GitHub call
  "snapshots": [
    { "period": "month", "rangeKey": "", "orgCreatedAt": "...",
      "windowFrom": "...", "windowTo": "...", "generatedAt": "...", "entryCount": 12 }
  ]
}
```

### `POST /leaderboard/:org/refresh`

Query params:

- `period` — optional; omit to refresh `month` and `all` sequentially
- `from`, `to` — required when `period=custom`
- `force` — `0` (default) or `1`; `1` bypasses the freshness window

```jsonc
// 200
{
  "org": "microclub-usthb",
  "results": [
    { "orgLogin": "microclub-usthb", "period": "month", "rangeKey": "",
      "generatedAt": "...", "windowFrom": "...", "windowTo": "...",
      "entryCount": 12, "warnings": [], "skipped": false }
  ]
}
```

The endpoint is public but rate-limited (`RATE_LIMIT_REFRESH_*`) because each run spends GitHub
quota.

GitHub failures are mapped and never surface as `500` from this endpoint:

| Upstream | Response |
|---|---|
| Org doesn't exist | `404` |
| Rate limited (HTTP 429, or 403 with quota exhausted) | `503` + `Retry-After` when GitHub sent a reset time |
| Bad/insufficient token (401/403) | `502` with GitHub's explanation |
| Network failure / GitHub 5xx | `502` |

---

## Scheduling

- `LEADERBOARD_CRON` (default every 6 hours) refreshes `month` and `all` for every org in
  `LEADERBOARD_ORGS`.
- The server runs the same refresh **once at boot**, so the default org has a snapshot before the
  first visitor arrives.
- Runs are **sequential** with overlap protection (`noOverlap`), and the timer is `unref`'d so it
  never keeps the process alive.
- `custom` ranges cannot be scheduled — they are refreshed on demand.
- **Empty `LEADERBOARD_ORGS` disables the scheduler** (logged as a warning at boot); manual
  refresh still works for any org.
- A failure in one org or period is logged and swallowed — the read path keeps serving the
  previous snapshot either way.

### Failure behavior (by design)

The read path has **no dependency on GitHub**. If GitHub is unreachable, rate-limited, or
returning errors:

- `GET /leaderboard/:org` keeps serving the last cached snapshot (`200`, same ETag),
- `POST .../refresh` fails as an upstream error (`502`/`503`), not a crash.

---

## Architecture

```
backend/
  routes/        Express routers (input surface, refresh rate-limit bucket)
  controllers/   HTTP semantics: validation, status codes, ETag, GitHub→HTTP error mapping
  services/
    leaderboard/   collector → aggregator → sync (single-flight writes, TTL cache)
    github/        typed REST/GraphQL client (timeout, backoff, rate-limit merge)
  models/        Mongoose schema (LeaderboardSnapshot) + migration
  jobs/          node-cron scheduler + boot refresh
  middleware/    request logging, error handling
  lib/           structured JSON logger, bounded-concurrency helper
  config/        zod-validated config, fail-fast at boot
  infra/db/      MongoDB connection
  app.ts         Express app (middleware + routes)
  server.ts      entry point (DB connect, migration, listen, boot refresh, cron)
```

Key decisions:

- **Layered:** routes → controllers → services → models. Controllers never touch GitHub
  directly; services never know about Express.
- **ESM** with `.js` import suffixes; type-only imports use `import type`.
- **Single-flight sync:** concurrent refreshes for the same `{org, period, rangeKey}` coalesce
  into one GitHub collection run.
- **GraphQL batching:** contributions are queried 10 logins per request with variables only, never
  string-interpolated. Batches run with bounded concurrency (4); repository contributor scans use
  5.
- **All-branch repository scan:** every visible repository (forks included) is read in two passes.
  The first pass records default/`gh-pages` commit SHAs and any private fallback counts; the second
  pass adds non-default-branch commits, PRs closed/merged after being opened, and solved issues.
  Commit SHAs are deduplicated globally so merged commits are never counted twice. Scans use bounded
  concurrency (3 repositories, 4 branches).
- **Member discovery:** `membersWithRole` when the token may read it; otherwise public members +
  contributors of every visible repository. Repository contributors are unioned on **both** paths,
  and the repository scan also discovers PR authors, reviewers and issue participants who never
  committed. Outside collaborators come from REST `/orgs/{org}/outside_collaborators` (no GraphQL
  field exists); a `403` there is expected for non-owner tokens and is not reported as a snapshot
  warning.
- **Private repositories:** listed when the token can see them. With `read:user`, GitHub's
  `contributionsCollection` already includes private activity, so only the extras are merged.
  Without it (fine-grained tokens), the full all-branch scan of private repositories supplies every
  metric, so private work is still ranked instead of silently disappearing.
- **External projects (opt-in):** empty by default, so the board is strictly organization-scoped.
  Repositories named in `LEADERBOARD_EXTRA_REPOS` are resolved through GraphQL and marked
  `external`. They are scanned only after every organization repository, so the complete org commit
  set can suppress duplicate SHAs. Their activity is always merged from the direct scan because the
  organization-scoped contribution graph cannot see them, and only for accounts that already have
  organization activity in the same window.
- **Resilient collection:** bot logins are dropped before querying, and a single unresolvable login
  is retried alone and skipped instead of failing the batch.
- **Security:** helmet, per-IP refresh rate limiting, credential redaction in logs, query strings
  never logged (they may carry secrets). No user accounts, no JWT, no cookies.

### Logging

One JSON object per line:

```json
{"method":"POST","path":"/leaderboard/microclub-usthb/refresh","status":200,"durationMs":8213.4,"time":"2026-11-22T17:21:40.114Z","level":"info","msg":"request"}
```

Envelope fields (`time`, `level`, `msg`) are written last so caller fields can't forge them, and
any key matching `token|secret|password|authorization|credential|cookie|api key` is redacted
automatically. The logger never throws (unserializable fields degrade to a note).

---

## Testing

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run build       # compile to dist/
```

Live verification performed against `MicroClub-USTHB`:

- all three periods collect successfully with **0 warnings**,
- `month` ≈ 8s, `custom` ≈ 7.5s, `all` ≈ 37s (bounded concurrency),
- `GET` returns `200`, unknown org returns `202` for reads and `404` for refresh,
- `period=7d` and malformed custom ranges return `400`,
- ETag round-trip returns `304`,
- `/meta` reports `orgCreatedAt` and the stored snapshots.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with watch (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Strict type check |

---

## Project history

Built phase by phase, each gated on typecheck and live verification before moving on:

- **Foundations** — fail-fast config, centralized error middleware, helmet + rate limiting,
  app/server split, structured logging with redaction, strict tsconfig.
- **GitHub client** — timeouts, capped backoff honoring `retry-after`/`reset`, non-retryable
  permission errors, rate-limit header merging, bounded pagination, no token leakage.
- **Collection & scoring** — pure aggregator, member/outside-collaborator collector, snapshot
  model, single-flight sync.
- **API & scheduling** — leaderboard controller (ETag/304, 202 while empty, GitHub→HTTP mapping),
  dedicated refresh rate-limit bucket, cron with overlap protection.
- **Public rebuild (Nov 2026)** — removed authentication entirely; replaced fixed windows with
  `month | all | custom`; added per-range snapshots, TTL caching with `force`, multi-year chunking,
  bounded concurrency, boot refresh, the member-discovery fallback, bot filtering, and a
  `202`-driven auto-refresh contract for the UI.
