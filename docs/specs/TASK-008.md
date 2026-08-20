# TASK-008 — Subscription

Phase 2. Depends on TASK-006 (customers) and TASK-007 (prices). Approved
decisions: a four-state lifecycle with cancel-at-period-end, the current
period held on the subscription, and a scope covering the lifecycle plus MRR.

## Goal

Connect a customer to a price and know what that is worth per month. This is
where the MRR on the dashboard comes from.

## Scope

- `subscriptions`, workspace-scoped, joining a customer to a price
- States `trialing`, `active`, `past_due`, `canceled`
- Cancel at period end by default, cancel immediately on request, resume while
  the period is still running
- Change the price on an existing subscription
- Renew: advance the period by the price's interval
- MRR summary, normalising yearly to monthly

## Non-goals

- Money. No invoices, no charges, no proration — TASK-013.
- Scheduling. `renew` is an endpoint, not a cron; TASK-011 will call it.
- Dunning. `past_due` exists for TASK-013 to set; nothing sets it here.
- Usage-based billing, seats, add-ons.
- Any UI.

## Database changes

Migration `0006_subscriptions`, reversible.

`subscriptions` — `id`, `workspace_id` FK cascade, `customer_id` FK cascade,
`price_id` FK **restrict**, `status`, `cancel_at_period_end` (bool),
`current_period_start`, `current_period_end` (both nullable — a `one_time`
price has no period), `trial_ends_at`, `canceled_at`, `ended_at`, timestamps.

`price_id` is `restrict`, not cascade: a price that something is subscribed to
must not disappear, and TASK-007 already refuses to delete a priced product.
That makes the guarantee two-sided.

Partial unique on `(customer_id, price_id) where status <> 'canceled'` — one
live subscription per customer per price, while allowing a customer to
resubscribe after cancelling.

Indexed on `(workspace_id, status)` for the summary and `(workspace_id, id)`
for pagination.

## API changes

Under `/orgs/:orgId/workspaces/:workspaceId/subscriptions`.

| Endpoint           | Permission           | Notes                                     |
| ------------------ | -------------------- | ----------------------------------------- |
| `POST /`           | `subscription:write` | customerId, priceId, optional trialDays   |
| `GET /`            | `subscription:read`  | `status`, `customerId`, `cursor`, `limit` |
| `GET /summary`     | `subscription:read`  | MRR, counts by status                     |
| `GET /:id`         | `subscription:read`  |                                           |
| `PATCH /:id`       | `subscription:write` | Change price                              |
| `POST /:id/cancel` | `subscription:write` | `{ immediately?: boolean }`               |
| `POST /:id/resume` | `subscription:write` | Clears cancel-at-period-end               |
| `POST /:id/renew`  | `subscription:write` | Advances the period                       |

`GET /summary` is declared before `GET /:id` so the literal path wins over the
parameter — otherwise `summary` is read as an id and every request 404s.

## UI changes

None.

## Acceptance criteria

- A customer and a price from another workspace are both rejected: creating a
  subscription across a boundary is 404, not a foreign key error
- A `one_time` price produces a subscription with no period and contributes
  nothing to MRR
- Cancelling sets `cancel_at_period_end` and leaves the status `active`;
  access is unchanged until the period ends
- Cancelling immediately sets `canceled`, stamps `canceled_at` and `ended_at`
- Resume clears the flag, and fails on a subscription already `canceled`
- Renewing advances the period by exactly one interval from the previous end,
  not from now, so a late renewal does not lose a day
- Renewing a subscription flagged to cancel ends it instead of extending it
- A trial sets `trialing` and `trial_ends_at`; the period still starts now
- Changing the price recalculates nothing retroactively; MRR reflects the new
  price from that moment
- MRR counts `active` and `trialing`, normalises yearly to monthly, and
  excludes `canceled`, `past_due` and one-off prices
- A customer cannot hold two live subscriptions to the same price, but may
  resubscribe after cancelling
- `yarn verify` passes

## Tests

- MRR arithmetic as a pure function: monthly, yearly, one-off, mixed
  currencies, empty, and rounding of a yearly price that does not divide by 12
- Period advance from the previous end rather than from now
- Every lifecycle transition, including the invalid ones
- Cross-workspace rejection for both the customer and the price
- The partial unique index: duplicate live subscription refused, resubscribe
  after cancelling allowed
- `restrict` on the price: deleting a subscribed price fails
- Route ordering: `GET /summary` is not swallowed by `GET /:id`

## Security considerations

- The customer and the price are both re-checked against the resolved
  workspace before insert, so a valid id from another tenant is 404 rather
  than a 500 from a foreign key
- Every query filters on `workspace_id`
- Money stays integer minor units; MRR is computed in cents and never touches
  a float
- Mixed currencies are reported per currency rather than summed, because
  adding USD to EUR silently would produce a confident wrong number

## Performance considerations

- The summary is one grouped query over `(workspace_id, status)`, not a scan
  per subscription
- Keyset pagination on `(workspace_id, id)`, as elsewhere
- MRR is computed on read. At one company's scale that is cheaper and always
  correct; a materialised figure is a TASK-012 concern if it stops being
