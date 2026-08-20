# TASK-010 — AI usage tracking

Phase 3. Depends on TASK-009. Approved decisions: metadata only with no prompt
or answer stored, totals aggregated on read, and every call recorded including
the ones that fail.

## Goal

Finish CLAUDE.md rule 8. TASK-009 computes what each request cost; this makes
it a record nobody can forget to write, and gives the numbers back.

## Scope

- `ai_requests`, one row per call, workspace-scoped
- Recording inside `AiService`, around the provider call, so a caller cannot
  bypass it by not being the HTTP endpoint
- Failures recorded too, with whatever usage the vendor reported before it
  failed and the reason it did
- `GET .../ai/usage` — totals by provider and model over a date range
- `GET .../ai/requests` — the rows, paginated

## Non-goals

- Spend caps. Offered and declined; a budget that refuses a call belongs with
  the task that can also raise it.
- Storing prompts or answers, hashed or otherwise.
- Daily rollups. On-read aggregation is exact and fast enough; TASK-012 can add
  them if a dashboard proves otherwise.
- Alerting on spend — Phase 6.

## Database changes

Migration `0007_ai_requests`, reversible.

`ai_requests` — `id`, `workspace_id` FK cascade, `user_id` FK **set null**,
`provider`, `model`, `status` (`succeeded` | `failed`), `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_write_tokens`,
`cost_micro_usd` (bigint), `duration_ms`, `error_code` (nullable),
`stop_reason` (nullable), timestamps.

`user_id` is `set null` for the same reason a customer note's author is: the
spend happened and the record of it should outlive the person leaving.

`cost_micro_usd` is **bigint**. A million requests at a dollar each would
overflow `integer`, and a cost column that silently wraps is worse than no
column.

Indexed on `(workspace_id, created_at)` for the range queries the summary runs,
and `(workspace_id, id)` for pagination.

## API changes

| Endpoint              | Permission | Notes                                      |
| --------------------- | ---------- | ------------------------------------------ |
| `GET .../ai/usage`    | `ai:read`  | `from`, `to`; totals by provider and model |
| `GET .../ai/requests` | `ai:read`  | `status`, `model`, `cursor`, `limit`       |

## UI changes

None. TASK-015 draws the dashboard.

## Acceptance criteria

- A successful call writes exactly one row carrying the same tokens and cost
  the response reported
- A failed call writes a row with `status = 'failed'`, the error's code, and
  whatever usage was known — and the original error still reaches the caller
  unchanged
- A failure to write the record does not fail the request. The answer has been
  paid for; losing it because bookkeeping failed would be the worse outcome
- No prompt or completion text is stored anywhere in the table
- Totals equal the sum of the rows they cover, exactly, with no floating point
  anywhere in the path
- A range with no requests returns zeroes rather than an empty body
- Rows and totals are workspace-scoped: another tenant's spend is invisible
- Deleting a user leaves their requests with a null user and the cost intact
- `yarn verify` passes

## Tests

- The recorder writes what the result reported, including cache buckets
- A failed call records the failure and rethrows the original error
- A recorder that itself throws does not break the request
- Nothing in the row resembles the prompt or the answer
- Totals against known rows, including an empty range and multiple models
- Cross-tenant invisibility on both endpoints
- The `set null` cascade on user deletion

## Security considerations

- The table holds no prompt and no completion, so a leak exposes spend patterns
  rather than customer content
- Both endpoints are workspace-scoped behind the existing guards
- `error_code` stores the domain code, never a vendor message, so a provider's
  error body cannot reach the database
- Costs are integers end to end, so no total can drift from the rows

## Performance considerations

- One insert per AI request, which is negligible beside a call that takes
  seconds
- The summary is a single grouped query on `(workspace_id, created_at)`
- Recording happens after the provider returns, so it adds nothing to the
  latency the caller waits on beyond the insert itself
