# Review gates — TASK-007

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0005_products.sql` and its `.down.sql`;
`backend/src/database/schema/products.ts` and `product-prices.ts`;
`backend/src/products/` (module, controller, service, tests);
`shared/src/products.ts`. Modified: `permissions.ts` (two entries),
`app.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`. Also
`backend/src/common/postgres-errors.ts`, extracting the `isUniqueViolation`
helper the last review gate recorded as debt in three services.

**2. What database changes are required?**
Two tables, following TASK-006's shape closely enough that the partial unique
index on SKU is the same pattern as the one on customer email. The constraint
that matters is not in the schema: prices are immutable by having no endpoint
that writes them, because a database-level guarantee would need a trigger, and
a trigger is a rule nobody reading the service would see.

**3. What APIs are affected?**
Ten routes added, all new, under the existing scoped prefix. `permissions.ts`
gains two entries. Nothing existing changes shape.

**4. What existing behavior could regress?**
The permission map again — it is now touched by a third task, and its
exhaustive test will fail on any change, which is what caught the TASK-006
edit. Extracting `isUniqueViolation` touches three existing services, so their
conflict paths are the regression risk; all three already have tests asserting
409 on duplicates, and those must keep passing untouched.

**5. What tests are needed?**
The immutability claim needs testing as an absence, which is awkward: the test
is that `PATCH` with price fields in the body changes nothing, since there is
no route to assert against. Then delete-vs-archive in both directions, archive
idempotence, prices outliving their product's archiving, currency
normalisation, the zero and negative boundaries, the partial SKU index with
several null SKUs, and the isolation sweep.

**6. Are there simpler alternatives?**
Mutable prices with an `updated_at` — simpler, and the reason "we raised our
prices and everyone's bill changed" happens. Rejected. A single price on the
product was offered and declined. Deleting products outright would remove the
archive machinery, and would leave TASK-008 with subscriptions pointing at
nothing. Storing currency as text without validation would save a check and
let arbitrary strings reach an invoice.

## After implementation

**1. What changed?**
New `backend/src/products/`: `products.service.ts`, `products.controller.ts`,
`products.module.ts`. New schema for `products` and `product_prices`, migration
`0005_products` with its down file, and `shared/src/products.ts`. New
`backend/src/common/postgres-errors.ts`, replacing the three copies of
`isUniqueViolation` the last review gate recorded as debt. Modified:
`permissions.ts`, `zod-validation.pipe.ts`, `app.module.ts`, both barrels,
`README.md`, `docs/BACKLOG.md`.

The validation pipe's constructor now takes `ZodType<T, ZodTypeDef, unknown>`
rather than `ZodSchema<T>`: a schema that transforms — coercing a query string
to a number, uppercasing a currency — has a different input type from its
output, and the old signature required them to match.

**2. What tests were added?**
26 over HTTP, covering the catalogue, prices, delete-versus-archive, isolation
and permissions. Notably: that `%` and a fractional amount are rejected, that
`usd` is stored as `USD`, that several products may have no SKU, and that no
route changes an existing price — asserted by patching a product with price
fields in the body and reading the row back unchanged.

**3. What tests were run?**
`yarn verify` — the products file passes 26/26, repeatedly and in isolation
(5 consecutive clean runs). Against a running API: a price created as `usd`
came back `USD`; patching the product with `amountCents` and `currency` left
the row at `4900 USD`; archiving and adding a new price produced the intended
ladder, `4900 USD month active=false` above `5900 USD month active=true`; and
deleting a product with prices returned 409 naming archive as the remedy.

**4. Any known limitations?**

- **The backend suite became flaky when this task's sixth end-to-end file was
  added, and it is not fixed.** Roughly one full-suite run in three fails, in
  whichever file is running, as a burst of 404s or timeouts on routes that
  plainly exist. Individually every file passes: `products.e2e` is 5/5, and
  the committed TASK-006 tree is 16/16. Ruled out by measurement: a shared
  database (per-file databases made it worse and were reverted), connection
  pool exhaustion (a pool of 1 is clean), password hashing cost (10 ms),
  socket exhaustion (470 TIME_WAIT against 16,384 ports), libuv thread
  starvation (32 threads, unchanged), process accumulation (one process per
  file still flaked), HTTP keep-alive, and file parallelism (a single pinned
  fork still flaked). It needs its own task; the evidence is above and in the
  session log.
- Prices cannot be edited by design, so a typo in an amount is permanent and
  the only remedy is to archive it and add another.
- A product's currency is per price, so nothing stops one product from holding
  prices in two currencies.
- No tiers, no usage metering, no tax, no discounts.
- Still unverified since TASK-001: `docker compose up --build`.

**5. Any technical debt?**

- `ProductsService` imports `containsPattern` from `customers/search`. The
  helper is general and should move to `common/`.
- Two services now implement the same keyset pagination. A third should make it
  shared rather than copied again.
- The `active` filter on prices is parsed by a schema declared inline in the
  controller; it belongs in `shared` with the others.
- Price immutability is enforced by the absence of a route rather than by the
  database. A trigger would be stronger, at the cost of a rule invisible to
  anyone reading the service.

**6. Does this follow CLAUDE.md?**

- Rule 1 — scoping, pricing model and scope were approved before any code.
- Rule 2 — no new dependencies.
- Rule 3 — the duplicated `isUniqueViolation` was consolidated as part of this
  task rather than left for later.
- Rule 4 — no UI.
- Rule 5 — cross-workspace access is 404, and prices are only ever reached
  through a product that is itself scoped.
- Rule 6 — bodies and query strings both validate through the pipe.
- Rule 9 — the migration drops prices before products and is tested.
- Rule 10 — every module added ships with tests. The suite is complete but not
  currently reliable, which is recorded above rather than smoothed over.
