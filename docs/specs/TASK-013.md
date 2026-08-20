# TASK-013 — Billing

Phase 2, sequenced last. Depends on TASK-008 and TASK-012. Approved decisions:
invoices with manually recorded payments, issued on renewal and by hand, with
dunning and a link into the analytics ledger.

## Goal

Turn a subscription into something that asks to be paid, records whether it
was, and says so when it was not. This is also where `past_due` — defined in
TASK-008 and never set by anything — finally gets set.

## Scope

- `invoices`, `invoice_lines`, `payments`, workspace-scoped
- Lifecycle `draft` → `open` → `paid`, with `void` and `uncollectible` as the
  other two endings
- Renewal issues an invoice for the period it just started
- Payments recorded against an invoice; paying in full settles it
- Overdue open invoices move their subscription to `past_due`
- A paid invoice writes a revenue line into TASK-012's ledger, so the
  dashboard stops treating recurring revenue as the only kind

## Non-goals

- Card processing. No Stripe, no keys, no webhooks — declined, and nothing
  here can be tested for real without them.
- Proration on plan change. Offered and declined.
- Tax, dunning emails, credit notes, multi-currency invoices.
- PDF rendering.

## Database changes

Migration `0010_billing`, reversible.

`invoices` — `id`, `workspace_id` FK cascade, `customer_id` FK **restrict**,
`subscription_id` FK set null, `number`, `status`, `currency`,
`subtotal_micro_usd`, `total_micro_usd`, `amount_paid_micro_usd`,
`period_start`, `period_end`, `issued_at`, `due_at`, `paid_at`, `voided_at`,
timestamps.

`customer_id` is `restrict`: an invoice is a financial record of who owed
what, and deleting the customer must not erase it. Deleting a customer with
invoices therefore fails, which is the correct answer.

Partial unique on `(subscription_id, period_start) where subscription_id is
not null` — one invoice per subscription per period, so renewing twice cannot
bill twice.

`invoice_lines` — `id`, `invoice_id` FK cascade, `description`, `quantity`,
`unit_micro_usd`, `amount_micro_usd`, timestamps.

`payments` — `id`, `workspace_id` FK cascade, `invoice_id` FK cascade,
`amount_micro_usd`, `method`, `reference`, `received_on`, `recorded_by` FK set
null, timestamps.

Invoice numbers are per workspace and sequential within a year:
`INV-2026-0001`. Allocated inside the issuing transaction, so two concurrent
issues cannot take the same number.

## API changes

| Endpoint                      | Permission      | Notes                             |
| ----------------------------- | --------------- | --------------------------------- |
| `POST .../invoices`           | `invoice:write` | Draft, for a customer             |
| `GET .../invoices`            | `invoice:read`  | `status`, `customerId`, paginated |
| `GET .../invoices/:id`        | `invoice:read`  | With lines and payments           |
| `POST .../invoices/:id/issue` | `invoice:write` | Draft → open, numbers it          |
| `POST .../invoices/:id/pay`   | `invoice:write` | Records a payment                 |
| `POST .../invoices/:id/void`  | `invoice:write` | Open or draft → void              |
| `POST .../billing/sweep`      | `invoice:write` | Marks overdue, sets past_due      |

## UI changes

None.

## Acceptance criteria

- Renewing a subscription issues exactly one invoice for the new period, and
  renewing again for the same period issues none
- An invoice's total equals the sum of its lines, always
- Paying less than the total leaves it `open` with `amount_paid` recorded;
  paying the remainder settles it and stamps `paid_at`
- Overpaying is refused rather than silently accepted
- A paid invoice writes exactly one revenue line to the ledger, and voiding it
  afterwards is refused — a paid invoice is not voidable
- Only a draft can be issued, and only once
- The sweep moves subscriptions with an overdue open invoice to `past_due`,
  and moves them back to `active` when it is paid
- Invoice numbers are unique per workspace and do not collide under concurrent
  issuing
- Deleting a customer who has invoices fails rather than erasing the record
- `yarn verify` passes

## Tests

- Number allocation, including two concurrent issues from real transactions
- Totals matching lines after every mutation
- Partial payment, exact payment, overpayment refused
- The full status machine, including every illegal transition
- Renewal issuing once and not twice for a period
- The sweep in both directions, and that it is idempotent
- The ledger line written once on payment
- `restrict` on customer deletion

## Security considerations

- Invoices are financial records: they can be voided but never edited once
  issued, and never deleted
- Payments cannot exceed the outstanding amount, so a record cannot claim more
  was paid than was owed
- Money is integer micro-dollars throughout
- Everything is workspace-scoped behind the existing guards

## Performance considerations

- Number allocation is one indexed lookup inside the issuing transaction
- The sweep is one query for overdue invoices and one update per subscription
- Invoice totals are stored rather than recomputed on read, and recomputed from
  lines whenever lines change
