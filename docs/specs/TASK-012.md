# TASK-012 — Analytics

Phase 5. Depends on TASK-008 and TASK-010. Approved decisions: daily snapshots
for history, a recorded ledger for costs and one-off revenue, and a scope
covering the metrics API, the snapshot job and ledger entries.

Also lands the keyset pagination extraction five review gates had asked for:
six copies are now one helper, `src/common/pagination.ts`.

## Goal

The numbers on the dashboard sketch — revenue, MRR, customers, AI cost, gross
profit, margin — computed from what the system actually knows, plus enough
history to draw a line rather than a dot.

## Scope

- `metric_snapshots`: one row per workspace per day
- `ledger_entries`: recorded costs and one-off revenue
- `GET .../analytics/summary` — today's numbers
- `GET .../analytics/series` — a metric over a window, from snapshots
- Ledger entry create, list and delete
- A `snapshot` action for the TASK-011 scheduler, so history writes itself

## Non-goals

- Per-customer and per-product breakdowns. Offered and declined.
- Backfilling history. Snapshots start from the day the job first runs; there
  is nothing to reconstruct yesterday from, and inventing it would be worse
  than an honest gap.
- Forecasting, cohorts, churn curves.
- The dashboard itself — TASK-015.

## Database changes

Migration `0009_analytics`, reversible.

`metric_snapshots` — `id`, `workspace_id` FK cascade, `captured_on` (date),
`mrr_micro_usd` (bigint), `customers`, `active_customers`, `active_subscriptions`,
`ai_cost_micro_usd` (bigint), `recorded_cost_micro_usd` (bigint),
`recorded_revenue_micro_usd` (bigint), timestamps.
Unique on `(workspace_id, captured_on)` — a day has one row, and running the
job twice must correct it rather than duplicate it.

`ledger_entries` — `id`, `workspace_id` FK cascade, `entry_date` (date),
`kind` (`cost` | `revenue`), `category`, `amount_micro_usd` (bigint), `note`,
`created_by` FK set null, timestamps.
Indexed on `(workspace_id, entry_date)`.

Money is micro-dollars in bigint, as everywhere else.

## API changes

| Endpoint                      | Permission        | Notes                            |
| ----------------------------- | ----------------- | -------------------------------- |
| `GET .../analytics/summary`   | `analytics:read`  | Today, computed live             |
| `GET .../analytics/series`    | `analytics:read`  | `metric`, `days`; from snapshots |
| `POST .../ledger`             | `analytics:write` | A recorded cost or revenue line  |
| `GET .../ledger`              | `analytics:read`  | `from`, `to`, `kind`, paginated  |
| `DELETE .../ledger/:id`       | `analytics:write` | 204                              |
| `POST .../analytics/snapshot` | `analytics:write` | Captures today; idempotent       |

## UI changes

None.

## Acceptance criteria

- MRR matches what the subscriptions summary reports, because both come from
  the same function rather than two implementations of the same rule
- Gross profit is revenue minus AI cost minus recorded costs, and margin is
  gross profit over revenue — with margin reported as null, not zero, when
  revenue is zero, because dividing by nothing has no answer
- Running the snapshot twice in a day updates the row rather than adding one
- A series over a window with no snapshots returns an empty series, not an
  error
- Every figure is integer micro-dollars end to end
- Ledger amounts must be positive; the sign is carried by `kind`, so a
  negative cost cannot quietly become revenue
- Everything is workspace-scoped
- `yarn verify` passes

## Tests

- The margin arithmetic, including zero revenue, zero cost, and a loss
- MRR agreeing with the subscriptions summary on the same data
- Snapshot idempotence within a day, and a second day adding a row
- The series shape over a window, including an empty one
- Ledger validation: negative amounts, missing category, cross-tenant access
- That deleting a user leaves their ledger entries with a null author

## Security considerations

- Both endpoints are workspace-scoped behind the existing guards
- Ledger entries are financial records; deleting is permitted, editing is not,
  so a figure that has been reported cannot be quietly rewritten
- All money is integer micro-dollars, so no total drifts from its parts

## Performance considerations

- The summary is a handful of grouped queries over indexed columns
- The series reads snapshots directly — one indexed range scan, which is the
  whole reason snapshots exist
- The snapshot job is one write per workspace per day
