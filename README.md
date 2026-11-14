# DevLeaderboard

A GitHub organization leaderboard API. It collects contribution activity for every member of an
organization across **all of its repositories**, ranks them with a composite score, caches the
result in MongoDB, and serves it over a small HTTP API — so the read path never talks to GitHub.

- **Stack:** Express 5 · TypeScript (ESM) · Mongoose · Node 22+
- **Data source:** GitHub GraphQL API (members + contributions) with a REST fallback for outside
  collaborators
- **Refresh model:** scheduled (cron) + manual refresh → Mongo cache → cheap reads with ETag/304

## Quick start

The entire project lives in [`backend/`](backend/):

```bash
cd backend
npm install
cp .env.example .env        # then fill in JWT_SECRET and GITHUB_TOKEN
npm run dev                 # http://localhost:3000
```

## Project layout

```
backend/
  app.ts              Express app (helmet, rate limits, routes, error handling)
  server.ts           entry point (DB connect, listen, cron, graceful shutdown)
  routes/             Express routers (auth, leaderboard + rate-limit buckets)
  controllers/        HTTP semantics: validation, status codes, ETag, GitHub→HTTP error mapping
  services/
    leaderboard/      collector → aggregator → sync (single-flight writes)
    github/           typed REST/GraphQL client (timeout, backoff, rate-limit merge)
  models/             Mongoose schemas (User, LeaderboardSnapshot)
  jobs/               node-cron scheduler
  middleware/         auth (requireAuth), request logging, error handling
  lib/                structured JSON logger (level filtering + credential redaction)
  config/             zod-validated config, fail-fast at boot
  infra/db/           MongoDB connection
```

## API overview

All responses are JSON; errors use `{ "error": "..." }`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create an account, returns `{ user, token }` |
| `POST` | `/auth/login` | — | Sign in, returns `{ user, token }` |
| `GET` | `/leaderboard/:org` | — | Snapshot from Mongo (never hits GitHub); `?period=7d\|30d\|year&limit=1..100`, supports ETag/304 |
| `GET` | `/leaderboard/:org/meta` | — | Score weights, GitHub rate-limit budget, snapshot freshness |
| `POST` | `/leaderboard/:org/refresh` | Bearer JWT | Trigger a refresh (spends GitHub quota) |
| `GET` | `/health` | — | `{ "status": "ok" }` |

## Scripts

Run from `backend/`:

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with watch (`tsx watch`) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Strict type check |

---

Full documentation — environment variables, scoring formula, periods, scheduling, failure
behavior and logging — is in [`backend/README.md`](backend/README.md).
