# Review gates — TASK-010

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0007_ai_requests.sql` and its `.down.sql`;
`backend/src/database/schema/ai-requests.ts`;
`backend/src/ai/usage.service.ts` and its tests; `shared/src/ai-usage.ts`.
Modified: `ai.service.ts` (record around the call), `ai.controller.ts` (two
routes), `ai.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
One table. Two column choices matter. `cost_micro_usd` is `bigint` because
micro-dollars are a millionth of a dollar and `integer` tops out around
$2,147 — a cost column that wraps silently is worse than no column. `user_id`
is `set null` so a departure does not erase the record of money that was spent.

**3. What APIs are affected?**
Two routes added. `POST .../ai/complete` gains a side effect — it now writes a
row — but its request and response shapes are unchanged, which the existing
TASK-009 tests will confirm by continuing to pass untouched.

**4. What existing behavior could regress?**
The AI path is the risk, and in two directions. Recording must not swallow a
provider error, or a failed call would look successful; and recording must not
be able to fail the request, or a bookkeeping problem would throw away an
answer the customer has already been charged for. Both directions get a test.

**5. What tests are needed?**
That the row matches the response exactly, including cache buckets. That a
failure records and rethrows the original error rather than a wrapped one.
That a recorder which itself throws leaves the request intact. That no column
contains the prompt or the answer — asserted directly, because "we did not
store it" is the kind of claim that quietly stops being true. Then the totals
against known rows, an empty range, and the cross-tenant sweep.

**6. Are there simpler alternatives?**
A Nest interceptor on the controller would record without touching the service,
and would miss every internal caller — TASK-011's automation engine will call
`AiService` directly, and rule 8 says _every_ request. Making the caller record
is simpler still and fails the first time somebody forgets. Storing cost as a
numeric would avoid thinking about integer widths and would reintroduce the
float this codebase has kept out of money everywhere else.

## After implementation

**1. What changed?**
New `backend/src/ai/usage.service.ts` (recorder plus the two read paths),
`backend/src/database/schema/ai-requests.ts`, migration `0007_ai_requests`
with its down file, and `shared/src/ai-usage.ts`. Modified: `ai.service.ts`
(records around the provider call and now takes a caller),
`ai.controller.ts` (two routes, and passes workspace and user through),
`ai.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`.

`AiService.complete` gained a second parameter — who is spending, and where.
Attribution has to come from the request, and defaulting it would have made
every internal caller anonymous by accident.

**2. What tests were added?**
22, taking the suite from 321 to 343. On the recorder: that it writes what it
was handed, defaults absent cache buckets, and — the one that matters — does
not throw when the database is down or when the insert blows up synchronously.
On the service: that a success records the same numbers it returns, that a
failure records and **rethrows the original error unchanged**, that nothing
resembling a prompt reaches the recorder, and that an unknown model records
nothing because nothing was spent. Over HTTP: that a call leaves exactly one
row, that neither prompt nor answer is stored, that a failed call is recorded
while still surfacing, that totals match the rows, that an empty range returns
zeroes, and the cross-tenant sweep.

**3. What tests were run?**
`yarn verify` passes — 343 backend, 7 shared, 9 frontend. Against a running
API: an empty workspace returned zeroes rather than an empty body; three seeded
rows produced `requests=3 failed=1 inputTokens=3000 costMicroUsd=52500`, which
matches `select count(*), sum(...)` over the same rows exactly; and deleting
the user left all three rows with `user_id` null and the cost intact. The
database confirms `cost_micro_usd` is `bigint`, and the column list contains no
field capable of holding a prompt.

**4. Any known limitations?**

- Still no live vendor call, for the same reason as TASK-009: no keys here. The
  recording path is exercised end to end against a stub provider, so what is
  proven is that a result becomes a row — not that a real vendor's result does.
- Streaming is not recorded. `AiService.stream` exists from TASK-009 and no
  longer matches `complete`: it computes cost but writes no row. Nothing calls
  it yet, and TASK-011 must not use it until this is fixed.
- No spend caps, no alerting, no retention policy. Rows accumulate forever.
- `costCents` on the summary rounds once at the end, so it can differ by a cent
  from summing the per-model lines rounded individually. The micro-dollar
  totals are exact and are what any billing should use.
- Aggregation is on read with no rollups. Exact, and fast at this scale; a
  dashboard reading years of history is TASK-012's problem to measure.

**5. Any technical debt?**

- `AiService.stream` and `AiService.complete` have diverged. The recording
  should move somewhere both share before anything consumes the stream.
- The per-request log line from TASK-009 now duplicates the row. One of them
  should go; the log is the redundant one.
- `usage.service.ts` holds both the write path and the read paths. It is small,
  but a recorder and a reporter are different jobs.
- The keyset pagination here is the fifth copy in this codebase. Four review
  gates have now said so.

**6. Does this follow CLAUDE.md?**

- Rule 1 — contents, aggregation and scope were approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — cost is still computed in one place; this task records what that
  produced rather than recomputing it.
- Rule 4 — no UI.
- Rule 5 — the table holds no prompt and no completion, and `error_code` stores
  the domain code rather than a vendor message.
- Rule 6 — both query strings validate through the pipe.
- Rule 8 — **now met.** Every request through `AiService` records usage and
  cost, successes and failures alike, at a choke point no caller can go around.
  The exception is the unused streaming path, recorded above as a limitation.
- Rule 9 — the migration is reversible and tested.
- Rule 10 — every module added ships with tests.
