# Phase Progress — DevLeaderboard

> **Status: paused mid-Phase 5 — "done for today" (user request).**
> No phase is being completed right now; handoff notes below only.

## Completed phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold & shell (Vite, React 19, Tailwind v4 tokens, router, providers, ESLint) | ✅ done |
| 1 | API layer (`shared/api/types.ts`, `shared/api/client.ts`, `cn`, `format`) | ✅ done |
| 2 | Leaderboard read path (queries, table/cards, period tabs, all states) | ✅ done |
| 3 | Meta & resilience (ETag/304, toasts, stale banner, failure drill vs dead GitHub) | ✅ done |
| 4 | Auth (context/provider split, protected route, login/register pages) | ✅ done |

## Phase 5 — Refresh mutation (IN PROGRESS, paused today)

### Done
- `useRefresh` mutation added in `frontend/src/features/leaderboard/api.ts`.
  - Calls `POST /leaderboard/:org/refresh?period=X` (omitting `period` refreshes all periods).
  - On success: removes the org's cached ETag copies, invalidates meta, success toast.
  - On `401`: logout + session-expired toast + navigate to `/login` with `state.from`.
  - On `429`: retry-aware toast.
- **Fix applied today:** TS `2339` errors on mutation error fields (`Property ... does not exist on type 'never'`).

### Not done (resume next session)
1. Recreate `RefreshButton` component cleanly (a half-finished draft was written then **deleted** today; do not re-add the bad version).
2. Wire `RefreshButton` into `LeaderboardPage` (enable/disable by auth state, replace disabled "Run the first refresh").
3. Double-click protection via mutation `isPending`.
4. Phase 5 gate: `typecheck` + `lint` + full phase regression suite + refresh-specific checks, all green.

## Phase 6 — Tests (planned)

- Temporary vitest + Testing Library tests (API errors, leaderboard states, auth, refresh).
- Run green **twice**, then delete tests + test tooling before final commit (tests policy).

## Phase 7 — Cleanup & ship (final)

- Delete all temporary gate scripts (`phase*.gate.*`, `phase*.render.*`, temp db helpers) and debug helpers.
- Full clean-install gates (rm `node_modules`, reinstall, typecheck/lint/build, live API/render gates).
- Update root README.
- Final commit + push to GitHub.

## Issues found & fixed today (Phase 5 start)

1. `useMutation` `onError` error fields typed as `never` when using `isAuthError(error)` on a pre-typed `ApiError`.
   - Fixed by reading `error.status`, `error.retryAfterSeconds`, `error.message` into locals **before** any branch.
   - Typecheck + lint now green.
2. Half-finished `RefreshButton.tsx` draft (`handleClick` placeholder) was deleted; re-create cleanly when Phase 5 resumes.

## Gate summary (as of end of Phase 4 — all green)

- `typecheck`, `lint`, `build` ✅
- Phase 1 API (live) ✅ 15/15 · Phase 2 render ✅ 8/8 · Phase 3 API ✅ 18/18 · Phase 3 render ✅ 10/10 · Phase 4 API ✅ 16/16 · Phase 4 render ✅ 16/16
- Failure drill ✅ (dead `GITHUB_API_URL` → reads `200`, refresh `502`, reads `200` after)
