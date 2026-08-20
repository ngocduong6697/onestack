# Review gates — TASK-011

## Before implementation

**1. What files will change?**
New: `backend/drizzle/0008_automation.sql` and its `.down.sql`; schema files
for `workflows`, `jobs`, `runs`, `run_steps`;
`backend/src/automation/` (definition schema, queue, worker, scheduler,
actions, service, controller, module, tests); `shared/src/workflows.ts`.
Modified: `ai.service.ts` (record the streaming path), `permissions.ts`,
`app.module.ts`, both barrels, `README.md`, `docs/BACKLOG.md`.

**2. What database changes are required?**
Four tables. The one with a real design decision is `jobs`: its index is
`(status, run_at)` because that is exactly what the claim query filters and
orders by, and a claim that cannot use an index is a claim that locks the
table. `steps` on `workflows` is jsonb rather than a fifth table — a definition
is written and read whole, never queried by step.

**3. What APIs are affected?**
Eight routes added. `AiService.stream` changes behaviour: it will record usage
as `complete` already does. Nothing calls it yet, so nothing regresses, but the
change is what makes it safe for this task to use.

**4. What existing behavior could regress?**
Three risks. A poller running inside the API means the API now does background
work — a runaway worker would compete with request handling, so the poll is
bounded and sleeps when idle. `AiService` is edited, and its TASK-009 and
TASK-010 tests must keep passing untouched. And the worker starts on boot,
which every existing end-to-end test would then also start; it must be
possible to leave it off, or every test suite grows a background process.

**5. What tests are needed?**
The claim has to be tested under genuine concurrency — two connections, real
transactions — because `FOR UPDATE SKIP LOCKED` either works or silently
double-processes, and reasoning about the SQL is not evidence. Lock
reclamation needs a job left `running` with an old lock. The SSRF block needs
the forms an attacker would actually try: `localhost`, `127.0.0.1`, `10.x`,
`169.254.169.254`, and a hostname that resolves to one of them. Then backoff,
the dead transition, step ordering and skipping, templates, cron across a DST
boundary, and that an AI step writes to `ai_requests`.

**6. Are there simpler alternatives?**
`SELECT ... FOR UPDATE` without `SKIP LOCKED` is simpler and serialises every
worker behind one lock. Polling without a lock at all is simplest and
double-processes under concurrency — which for a paid AI call means paying
twice. Allowing any URL would remove the address checks and make this endpoint
a proxy for scanning the host's private network. Storing whole response bodies
would remove the truncation and hand any workflow author a way to fill the
disk.

## After implementation

**1. What changed?**
New `backend/src/automation/`: `queue.ts` (claim, backoff, dead), `worker.ts`
(poller and scheduler tick), `runner.ts` (steps, skipping, run records),
`actions.ts` (`ai.complete`, `http.request`), `safe-url.ts` (the SSRF guard),
`schedule.ts` (cron in a timezone), `templates.ts`, `workflows.service.ts`,
`workflows.controller.ts`, `automation.module.ts`. New schema for `workflows`,
`jobs`, `runs`, `run_steps`, migration `0008_automation` with its down file,
and `shared/src/workflows.ts`. Modified: `ai.service.ts` (the streaming path
now records), `main.ts` (starts the worker), `permissions.ts`, `app.module.ts`,
both barrels, `README.md`, `docs/BACKLOG.md`.

One dependency added: `cron-parser`. "Every day at 09:00 in Europe/London" is
not a fixed number of hours after the last firing, twice a year, and a
hand-rolled version of that is a bug with a six-month feedback loop.

**2. What tests were added?**
99, taking the suite from 343 to 442. The SSRF guard has 30 of them, covering
the addresses somebody would actually try — `127.0.0.1`, `10.x`, `172.16–31`,
`169.254.169.254`, `::1`, `fd00::`, `::ffff:127.0.0.1` — plus a public hostname
that resolves somewhere private, which is why the check is on the resolved
address. The queue has 14, two of which run genuinely concurrent claims. Cron
has 14, including a British Summer Time boundary where 09:00 local moves by an
hour in UTC. Templates have 14. The end-to-end file has 27.

**3. What tests were run?**
`yarn verify` passes — 442 backend, 7 shared, 9 frontend. Against a running
API with the worker live: a workflow aimed at `169.254.169.254` failed with
"That URL resolves to an address that may not be requested"; one aimed at a
public address returned 200 over the real network; and `file:///etc/passwd`
was refused at creation.

Two real bugs were caught by tests during the work. The raw `returning *` in
the claim hands back the database's snake_case columns, so `maxAttempts`
arrived as `undefined` — and `attempts >= undefined` is false, which quietly
turned "give up after three tries" into "retry forever". The assertion that
should have caught it earlier was `expect(lockedAt).not.toBeNull()`, which
passes on `undefined`; it now asserts a `Date`.

**4. Any known limitations?**

- One process polls. The claim is safe for several, and nothing yet runs a
  second — so throughput is one job at a time, and the API and the worker
  share a process.
- Polling costs up to a second of latency, and the scheduler ticks once a
  minute, so a schedule can fire up to a minute late.
- `POST /run` executes in the request rather than through the queue, so a
  slow workflow holds an HTTP connection open. It is the behaviour a caller
  wants from a manual run, but it is not the same path a scheduled run takes.
- No branching, no loops, no per-step retry: a workflow is a list.
- No inbound webhooks and no domain events; both were declined.
- Redirects are refused rather than re-checked, so a legitimate endpoint that
  redirects cannot be called.
- Still no live AI vendor call anywhere in this codebase.

**5. Any technical debt?**

- `runNow` duplicates what the worker does, in a different order. One of them
  should call the other.
- The keyset pagination is now in six places. Five review gates have said so.
- `Actions` handles both action types in one class; a third would want a
  registry.
- The worker holds both the poller and the scheduler. They have different
  failure modes and should probably be separate.

**6. Does this follow CLAUDE.md?**

- Rule 1 — execution model, triggers and scope were approved before any code.
- Rule 2 — one dependency, for the one part that is genuinely hard.
- Rule 3 — AI steps go through `AiService` rather than reimplementing a call;
  cost and recording stay defined once.
- Rule 4 — no UI.
- Rule 5 — the SSRF refusal is deliberately vague about what it protects, and
  stored errors and bodies are truncated.
- Rule 6 — bodies and query strings validate through the pipe, and workflow
  definitions are validated on write rather than by a worker at runtime.
- Rule 8 — **now complete.** The streaming path records too, so rule 8 no
  longer depends on which method a caller picked.
- Rule 9 — the migration drops children before parents and is tested.
- Rule 10 — every module added ships with tests, and the two dangerous parts
  — the claim and the address check — are tested adversarially.
