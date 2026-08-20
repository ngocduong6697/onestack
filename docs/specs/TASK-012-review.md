# Review gates — TASK-012

## Before implementation

**1. What files will change?**
New: `backend/src/common/pagination.ts` (the extraction), migration
`0009_analytics`, `backend/src/database/schema/analytics.ts`,
`backend/src/analytics/` (metrics arithmetic, service, controller, module,
tests), `shared/src/analytics.ts`. Modified: the five services that had their
own pagination, `subscriptions/mrr.ts` (export the earning statuses),
`automation/actions.ts` and `shared/src/workflows.ts` (a snapshot action),
`permissions.ts`, `app.module.ts`, both barrels, `README.md`.

**2. What database changes are required?**
Two tables. The unique index on `(workspace_id, captured_on)` is what makes
the snapshot job idempotent — running it twice corrects the day rather than
duplicating it. Ledger amounts are positive with the sign in `kind`, so a
negative cost cannot become revenue by arithmetic accident.

**3. What APIs are affected?**
Six routes added. Five existing services change shape internally as pagination
moves to the helper; their responses are unchanged, which their tests confirm
by continuing to pass untouched.

**4. What existing behavior could regress?**
The pagination extraction touches five working endpoints — the risk is an
off-by-one in the shared helper affecting all of them at once, which is why it
has its own tests including a full traversal. Moving `EARNING_STATUSES` changes
what the subscriptions summary counts if it is done wrong, so both callers must
agree, asserted directly.

**5. What tests are needed?**
The margin arithmetic, because it is the figure most likely to be quoted and
its edge case — no revenue — has a wrong-looking right answer. MRR agreeing
between the two endpoints that report it. Snapshot idempotence. An empty
series. Ledger validation including negative amounts. And the traversal test
for the extracted helper.

**6. Are there simpler alternatives?**
On-read history with no snapshots was offered and declined; it cannot answer
what MRR was last month once a subscription changes. Interpolating missing days
would make prettier charts out of data that does not exist. Letting ledger
amounts be signed would remove `kind` and make a mistyped minus a silent
reclassification.

## After implementation

**1. What changed?**
New `backend/src/analytics/`: `metrics.ts` (profit, margin, windows),
`analytics.service.ts`, `analytics.controller.ts`, `analytics.module.ts`.
New `metric_snapshots` and `ledger_entries` with migration `0009_analytics`,
and `shared/src/analytics.ts`. A third workflow action, `analytics.snapshot`.

Two pieces of long-standing debt closed. Keyset pagination is now
`src/common/pagination.ts`, used by six services — five review gates had asked
for this. And `EARNING_STATUSES` moved beside the MRR rule it belongs to, so
"what counts as revenue" has one definition rather than two.

**2. What tests were added?**
56, taking the suite from 450 to 506. The pagination helper has 8, including a
full traversal with no gaps or repeats. The metrics arithmetic has 17, among
them the original dashboard figures and the no-revenue case. Analytics
end-to-end has 27. Environment handling gained 6, for the bug below.

**3. What tests were run?**
`yarn verify` passes — 506 backend, 7 shared, 9 frontend. Against a running
API, seeded with 18 customers, a $2,100 monthly subscription and a $90 hosting
line, the summary endpoint reproduced the original sketch: revenue $2,100,
MRR $2,100, customers 18, infrastructure $90, gross profit $2,010, margin 96%.
Snapshotting twice left one row; the series returned that day's MRR as
2,100,000,000 micro-dollars.

**A real bug was found by that live run, not by the tests.** The API refused to
boot with `Invalid environment: ANTHROPIC_API_KEY: String must contain at least
1 character(s)`. The three provider keys were declared `z.string().min(1)
.optional()`, which treats an empty string as present-and-invalid — and this
repository's own `.env.example` ships `ANTHROPIC_API_KEY=`. Anyone copying the
example file would have been unable to start the server over three vendors they
were not using. Empty now means absent, with tests for the blank-`.env` case.

**4. Any known limitations?**

- MRR is summed across currencies into one figure here, while the subscriptions
  summary correctly keeps them apart. For a single-currency workspace they
  agree; for a mixed one this number adds dollars to euros. It should carry a
  currency, and does not.
- Snapshots have no backfill and none is possible. History begins the first
  time the job runs.
- The snapshot job is an action, so a workflow has to exist to call it. Nothing
  creates that workflow automatically.
- The summary's revenue is this month's recorded revenue plus current MRR,
  which mixes a rate with a total. It matches the sketch, and it is not a
  defensible accounting definition.
- No per-customer or per-product breakdowns.

**5. Any technical debt?**

- `AnalyticsService` runs five queries for one summary. Fine at this size,
  worth one grouped query if a dashboard polls it.
- The series omits uncaptured days rather than reporting them as gaps
  explicitly; a caller cannot tell "no data" from "zero" without checking dates.
- `windowDays` computes in UTC while snapshots are dated by the server's day.
  A workspace in another timezone will see a boundary off by one.

**6. Does this follow CLAUDE.md?**

- Rule 1 — history, inputs and scope were approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — MRR and the earning statuses now have one definition each, and
  pagination went from six copies to one.
- Rule 4 — no UI.
- Rule 5 — everything is workspace-scoped; nothing new is exposed.
- Rule 6 — bodies and query strings validate through the pipe.
- Rule 9 — the migration is reversible and tested.
- Rule 10 — every module added ships with tests, and the arithmetic that
  produces a quotable number is tested directly.
