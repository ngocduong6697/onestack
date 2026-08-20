# Review gates — TASK-008

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0006_subscriptions.sql` and its `.down.sql`;
`backend/src/database/schema/subscriptions.ts`;
`backend/src/subscriptions/` (module, controller, service, `mrr.ts`, tests);
`shared/src/subscriptions.ts`. Modified: `permissions.ts` (two entries),
`app.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
One table with three foreign keys, and the interesting choice is `restrict` on
`price_id` where everything else in this codebase uses `cascade`. A cascade
would delete subscriptions when a price is removed, which is the opposite of
what should happen: the price a customer agreed to must outlive any attempt to
tidy the catalogue. TASK-007 already refuses to delete a priced product, so
this closes the same door from the other side.

The partial unique index follows the pattern used for invitations and customer
emails: unique among rows that are still live, so cancelling and resubscribing
works.

**3. What APIs are affected?**
Eight routes added, all new. One ordering hazard: `GET /summary` must be
declared before `GET /:id`, or Nest matches the parameter first and every
summary request looks up a subscription with the id "summary". That is a test,
not a comment.

**4. What existing behavior could regress?**
The permission map gains two entries, which the exhaustive map test will catch
as it did twice before. Nothing else is touched; subscriptions read customers
and prices but never write them.

**5. What tests are needed?**
MRR arithmetic deserves unit tests rather than only end-to-end ones: it is the
number that ends up on a dashboard and in a decision, and it has real edge
cases — a yearly price that does not divide cleanly, mixed currencies, one-off
prices that must contribute nothing. Then the lifecycle, including transitions
that must fail, the two cross-workspace rejections, the partial unique index,
and the route-ordering check.

**6. Are there simpler alternatives?**
Cancelling immediately by default would remove `cancel_at_period_end` and a
resume endpoint, and would also mean somebody who cancels loses time they paid
for. Summing MRR across currencies into one number would remove the per
currency grouping and produce a figure that is confidently wrong the first
time a second currency appears. Computing the period from `started_at` plus n
intervals would remove two columns, and would drift the moment the price
changes.

## After implementation

**1. What changed?**
New `backend/src/subscriptions/`: `subscriptions.service.ts`,
`subscriptions.controller.ts`, `mrr.ts`, `periods.ts`, `subscriptions.module.ts`.
New `subscriptions` schema and migration `0006_subscriptions` with its down
file, and `shared/src/subscriptions.ts`. Modified: `permissions.ts`,
`app.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`.

MRR and period arithmetic were pulled out as pure functions rather than left
inside the service. Both have edge cases that deserve direct tests, and both
produce numbers somebody will act on.

**2. What tests were added?**
50, taking the suite from 211 to 261. Unit: 10 for MRR (yearly divided and
rounded, one-off contributing nothing, currencies kept apart, stable ordering)
and 11 for periods (31 January to 28 February, leap years, 29 February plus a
year, time of day preserved). 29 over HTTP: subscribing with and without a
trial, one-off prices, the duplicate rule and resubscribing, both cross-
workspace rejections, the full cancel/resume lifecycle including every invalid
transition, renewal from the previous end, renewal applying a scheduled
cancellation, price changes, the summary, and the route-ordering check.

**3. What tests were run?**
`yarn verify` passes — 261 backend, 7 shared, 9 frontend. Against a running
API: subscribing a customer at $49/month and another at $499/year produced
`{"currency":"USD","amountCents":9058}` — 4900 plus 49900/12 rounded to 4158.
Cancelling left the status `active` with `cancelAtPeriodEnd` true and no
`endedAt`; renewing then ended it, and MRR fell to 4158. Deleting a subscribed
price was refused by Postgres:

```
ERROR: update or delete on table "product_prices" violates foreign key
constraint "subscriptions_price_id_product_prices_id_fk"
```

**4. Any known limitations?**

- Nothing charges anybody. `past_due` is defined and never set; invoices,
  proration and dunning are TASK-013.
- `renew` is an endpoint nobody calls on a schedule yet, so periods only
  advance when something asks. TASK-011 owns that.
- A trial does not end by itself. `trial_ends_at` is recorded, and the status
  moves to `active` only when the subscription is renewed.
- Changing a price takes effect immediately with no money adjustment, which is
  correct only because no money moves yet.
- MRR is computed on read. Right at this scale, wrong at a much larger one.
- **The end-to-end suite still shows a residue of the FIX-001 failure.** One
  failure in twenty-four full-suite runs since, against roughly one in three
  before. The signature is identical — a foreign 404 on a route that exists —
  so listening once narrowed the window without closing it. The capture that
  diagnosed it the first time is now kept in `orgs.e2e`, so the next
  occurrence records its own evidence.

**5. Any technical debt?**

- Four services now implement the same keyset pagination. It should be one
  helper; this is the third review gate to say so.
- `EARNING` statuses are declared in the service, while the dashboard in
  TASK-012 will need the same definition. It belongs in `shared`.
- The summary runs two queries where one grouped query could serve both, which
  is fine now and worth revisiting when TASK-012 reads it repeatedly.

**6. Does this follow CLAUDE.md?**

- Rule 1 — lifecycle, period model and scope were approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — MRR is defined once, as a function, not recomputed per caller.
- Rule 4 — no UI.
- Rule 5 — cross-workspace ids are 404, checked before insert rather than left
  to a foreign key error that would leak existence through a 500.
- Rule 6 — bodies and query strings validate through the pipe.
- Rule 9 — the migration is reversible and tested.
- Rule 10 — every module added ships with tests, and the arithmetic that
  produces a business number is tested directly rather than only through HTTP.
