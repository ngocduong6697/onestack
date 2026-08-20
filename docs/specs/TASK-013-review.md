# Review gates — TASK-013

## Before implementation

**1. What files will change?**
New: migration `0010_billing`, `backend/src/database/schema/billing.ts`,
`backend/src/billing/` (state machine, service, controller, module, tests),
`shared/src/billing.ts`. Modified: `subscriptions.service.ts` (renewal issues
an invoice), `subscriptions.module.ts`, `permissions.ts`, `app.module.ts`,
both barrels, `README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
Three tables and two partial unique indexes that carry the guarantees. One on
`(subscription_id, period_start)` makes renewal idempotent — renewing twice
collides rather than billing twice. One on `(workspace_id, number)` makes
numbers unique while leaving drafts unnumbered. `customer_id` is `restrict`
rather than cascade, so deleting a customer with invoices fails.

**3. What APIs are affected?**
Seven routes added. `POST .../subscriptions/{id}/renew` gains a side effect:
it now issues an invoice. Its response is unchanged, which the TASK-008 tests
confirm by continuing to pass untouched.

**4. What existing behavior could regress?**
Renewal is the risk — it is the path TASK-011's scheduler will eventually
drive, and an invoice issued twice is a customer billed twice. The unique
index is the guarantee rather than the code path, and it is tested by renewing
the same period twice on purpose. Subscriptions now depends on billing, which
is a new module edge; if it were circular nothing would boot, so every existing
end-to-end suite is the check.

**5. What tests are needed?**
The status machine, exhaustively, with the illegal transitions named
individually — voiding a paid invoice, paying a draft, issuing twice.
Overpayment refused. Partial then settling payment. Renewal issuing once and
not twice. The sweep in both directions and twice over. And the `restrict`
behaviour asserted directly, because "the record survives" is the kind of
claim that quietly stops being true.

**6. Are there simpler alternatives?**
Stripe was offered and declined; it needs a key, a webhook endpoint TASK-011
declined, and a sandbox before any of it could be shown to work. Recomputing
totals from lines on every read would remove the stored columns and make every
list query a join with a sum. Letting payments exceed the total would remove a
check and produce records that look like reconciled money.

## After implementation

**1. What changed?**
New `backend/src/billing/`: `invoice-state.ts` (transitions, payment
application, number formatting), `billing.service.ts`, `billing.controller.ts`,
`billing.module.ts`. New `invoices`, `invoice_lines` and `payments` with
migration `0010_billing`, and `shared/src/billing.ts`. Renewal in
`subscriptions.service.ts` now issues the invoice for the period it started.

**2. What tests were added?**
47, taking the suite from 506 to 553. The state machine has 25, of which seven
name a transition that must be refused. End-to-end has 22, covering drafting,
sequential numbering, partial and settling payments, overpayment, voiding, the
renewal-idempotence case, dunning in both directions, and the `restrict`
constraint.

**3. What tests were run?**
`yarn verify` passes — 553 backend, 7 shared, 9 frontend. Against a running
API, a full cycle: renewing a $49 subscription issued one open invoice;
back-dating its due date and sweeping moved the subscription to `past_due`;
overpaying was refused with "That payment is more than the 49000000
micro-dollars outstanding"; paying properly settled it, restored the
subscription to `active`, and wrote `revenue invoice $49.00` to the ledger;
voiding it afterwards was refused with "An invoice cannot go from paid to
void"; and deleting the customer failed on the foreign key, as intended.

**4. Any known limitations?**

- **An invoice issued by renewal has no number.** `invoiceForPeriod` inserts
  it `open` with `number: null`, so it is a legitimate open invoice that never
  went through `issue()` and therefore never got numbered. It bills, it can be
  paid, and it will read as unnumbered on any statement. This is the sharpest
  edge in the task and it should be fixed before invoices are shown to anyone.
- `sweep.restored` is always zero. Restoration happens when a payment settles,
  not during the sweep, so the field reports nothing useful and should either
  be populated or removed.
- No proration, no credit notes, no tax, no PDF, no dunning emails.
- The sweep is per workspace and has to be called; nothing schedules it, though
  a workflow action could.
- No card processing, by decision — payments are recorded by hand.

**5. Any technical debt?**

- Number allocation reads the highest existing number inside the transaction.
  Correct under the unique index, but it is a read-then-write; a sequence per
  workspace would be simpler to reason about.
- `BillingService` handles invoices, payments and dunning. Three jobs.
- The ledger line is written by the billing service directly rather than
  through the analytics service that owns that table.

**6. Does this follow CLAUDE.md?**

- Rule 1 — payments, issuing and scope were approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — the transition rules and payment arithmetic live once, as pure
  functions, rather than inline in the service.
- Rule 4 — no UI.
- Rule 5 — everything is workspace-scoped; invoices cannot be edited once
  issued, only voided.
- Rule 6 — bodies and query strings validate through the pipe.
- Rule 9 — the migration drops children before parents and is tested.
- Rule 10 — every module added ships with tests, and the refusals are tested
  as carefully as the happy path.
