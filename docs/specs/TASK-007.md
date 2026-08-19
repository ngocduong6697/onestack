# TASK-007 — Product management

Phase 2. Depends on TASK-006's workspace scoping. Approved decisions:
workspace-scoped catalogue, prices as immutable child rows, and a scope
covering catalogue, prices, archiving and search.

## Goal

A catalogue of what you sell, priced in a way that lets you raise prices
without changing what existing subscribers already agreed to pay.

## Scope

- `products` and `product_prices`, workspace-scoped like customers
- Prices immutable once created: editing means adding a new one and archiving
  the old
- Intervals `one_time`, `month`, `year`; currency as ISO 4217
- Archiving rather than deleting once a price exists, so TASK-008 can never
  point at a row that vanished
- Search, stage filtering and keyset pagination, matching TASK-006 exactly

## Non-goals

- Tiers, volume breaks and usage metering. Offered and declined.
- Inventory. What this company sells is not physical.
- Tax rates, discounts and coupons. Billing is TASK-013.
- Currency conversion. A price is in one currency and stays there.
- Any UI.

## Database changes

Migration `0005_products`, reversible.

`products` — `id`, `workspace_id` FK cascade, `name`, `sku` (nullable),
`description`, `status` (`active` | `archived`), timestamps.
Partial unique on `(workspace_id, sku) where sku is not null`, for the same
reason customers has one on email: a SKU should be unique when present, and
absent on as many rows as you like.

`product_prices` — `id`, `product_id` FK cascade, `amount_cents` (integer,
non-negative), `currency` (char(3), uppercase), `interval`, `active`,
timestamps.

**Immutability is the point.** No endpoint updates `amount_cents`, `currency`
or `interval`. The only mutable field is `active`, and archiving a price is
what "changing the price" means — the old row stays so that a subscription
created against it still describes what was agreed.

A product cannot be deleted once it has prices; it is archived. A price cannot
be deleted at all.

## API changes

Under `/orgs/:orgId/workspaces/:workspaceId/products`.

| Endpoint                                   | Permission      | Notes                            |
| ------------------------------------------ | --------------- | -------------------------------- |
| `POST /`                                   | `product:write` | 201                              |
| `GET /`                                    | `product:read`  | `q`, `status`, `cursor`, `limit` |
| `GET /:productId`                          | `product:read`  | Includes its prices              |
| `PATCH /:productId`                        | `product:write` | Name, sku, description           |
| `DELETE /:productId`                       | `product:write` | 204, only while it has no prices |
| `POST /:productId/archive`                 | `product:write` | 200, idempotent                  |
| `POST /:productId/unarchive`               | `product:write` | 200                              |
| `POST /:productId/prices`                  | `product:write` | 201                              |
| `GET /:productId/prices`                   | `product:read`  | `active` filter                  |
| `POST /:productId/prices/:priceId/archive` | `product:write` | 200                              |

New permissions `product:read` and `product:write`, granted as customers are.

## UI changes

None.

## Acceptance criteria

- A price cannot be edited by any route: no endpoint accepts a new
  `amount_cents`, `currency` or `interval` for an existing price
- Archiving a price leaves its amount untouched and readable
- A product with prices cannot be deleted; the attempt returns 409 and says to
  archive instead
- A product with no prices can be deleted
- Archiving a product is idempotent and does not archive its prices, which stay
  readable so historic subscriptions still resolve
- Currency is stored uppercase whatever case it arrives in, and a
  non-ISO-shaped code is rejected
- `amount_cents` of 0 is allowed — free plans exist — but negative is not
- SKU uniqueness holds per workspace, is case-sensitive, and permits any number
  of products without one
- Cross-workspace and cross-organization access is 404 on every route
- `yarn verify` passes

## Tests

- Immutability: `PATCH` on a product ignores price fields entirely, and there
  is no route that mutates a price's amount
- Delete-vs-archive: refused with prices, allowed without
- Archive idempotence, and that prices survive their product being archived
- Currency normalisation and rejection of bad codes
- Zero and negative amounts
- The partial SKU index, including several products with no SKU
- Search and pagination, mirroring TASK-006's tests
- Isolation on every route, from both directions
- Permissions: a member reads, an admin writes

## Security considerations

- Every query filters on `workspace_id`, and prices are always reached through
  their product, which is itself scoped — a price id alone is not a capability
- Money is integer minor units, never a float
- Currency is validated against a three-letter shape and uppercased, so it
  cannot carry arbitrary text into a future invoice
- Immutable prices are also an integrity control: a compromised session cannot
  quietly rewrite what customers are charged, only add a price and archive one,
  both of which leave a record

## Performance considerations

- Keyset pagination on `(workspace_id, id)`, as in TASK-006
- Fetching a product with its prices is two queries, not N+1 across a list;
  the list endpoint does not embed prices
- `(product_id, active)` indexed for the common "current prices" read
