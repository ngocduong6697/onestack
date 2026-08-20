# TASK-011 — Automation engine

Phase 4. Depends on TASK-009 and TASK-010. Approved decisions: a Postgres job
queue claimed with `FOR UPDATE SKIP LOCKED` and worked in-process, manual and
scheduled triggers, and a scope covering the engine, two action types and run
history — plus fixing the streaming path TASK-010 left unrecorded.

## Goal

Work that happens without somebody pressing a button, with a record of what
ran, what it did, and what it cost.

## Scope

- `workflows`, `jobs`, `runs`, `run_steps`, all workspace-scoped
- A queue claimed with `FOR UPDATE SKIP LOCKED`, so two workers never take the
  same job even though only one runs today
- Retries with exponential backoff and a dead state after the last attempt
- A scheduler that enqueues due workflows on a tick
- Actions `ai.complete` and `http.request`
- Every step recorded: input summary, outcome, duration, and for AI steps the
  tokens and cost, which reach the same `ai_requests` table as everything else
- `AiService.stream` records usage like `complete` does, before anything uses it

## Non-goals

- Inbound webhooks and domain events. Both were offered and declined.
- Branching, loops, per-step retry policy. A workflow is a list of steps.
- A visual builder. Definitions are JSON.
- Distributed workers. The claim is safe for several; only one polls today.
- Secrets management for HTTP actions beyond what the environment already has.

## Database changes

Migration `0008_automation`, reversible.

`workflows` — `id`, `workspace_id` FK cascade, `name`, `enabled`,
`trigger_type` (`manual` | `schedule`), `cron` (nullable), `timezone`,
`steps` (jsonb), `next_run_at` (nullable), `last_run_at`, timestamps.

`jobs` — `id`, `workspace_id` FK cascade, `workflow_id` FK cascade, `status`
(`queued` | `running` | `succeeded` | `failed` | `dead`), `run_at`,
`attempts`, `max_attempts`, `locked_at`, `last_error`, timestamps.
Indexed on `(status, run_at)` — the claim query's only index.

`runs` — `id`, `workspace_id` FK cascade, `workflow_id` FK cascade, `job_id`
FK set null, `status`, `started_at`, `finished_at`, `error`, timestamps.

`run_steps` — `id`, `run_id` FK cascade, `index`, `action`, `status`,
`duration_ms`, `output` (jsonb, bounded), `error`, `cost_micro_usd`, timestamps.

`steps` is jsonb rather than a table: a workflow definition is edited as a
whole, never queried by step, and a `steps` table would buy joins nobody needs.

## API changes

Under `/orgs/:orgId/workspaces/:workspaceId/workflows`.

| Endpoint           | Permission       | Notes                              |
| ------------------ | ---------------- | ---------------------------------- |
| `POST /`           | `workflow:write` | Definition validated on the way in |
| `GET /`            | `workflow:read`  |                                    |
| `GET /:id`         | `workflow:read`  |                                    |
| `PATCH /:id`       | `workflow:write` | Including enable and disable       |
| `DELETE /:id`      | `workflow:write` | 204                                |
| `POST /:id/run`    | `workflow:run`   | Enqueues, returns the run          |
| `GET /:id/runs`    | `workflow:read`  | Paginated                          |
| `GET /runs/:runId` | `workflow:read`  | With its steps                     |

## UI changes

None.

## Acceptance criteria

- Two workers claiming at once never take the same job — proven with real
  concurrent transactions, not by reasoning about the SQL
- A failing job retries with growing backoff and goes `dead` after the last
  attempt, and a dead job is not picked up again
- A job whose worker dies mid-run is reclaimed after its lock ages out, rather
  than being stuck `running` forever
- A run records every step in order, with the ones after a failure marked
  skipped rather than left absent
- An AI step's cost lands in `ai_requests` as well as on the step, so rule 8
  holds no matter who called
- An HTTP action cannot reach a private address — no localhost, no link-local,
  no RFC 1918 — because a workflow is user input pointed at a URL
- A schedule computes the next run in the workflow's timezone, and a disabled
  workflow is never enqueued
- Steps see prior step output through a template, and a template referencing a
  step that has not run yet fails validation rather than at runtime
- Everything is workspace-scoped, and a run belonging to another tenant is 404
- `yarn verify` passes

## Tests

- The claim, under genuine concurrency, from two connections
- Backoff arithmetic, the dead transition, and lock reclamation
- Step ordering, skipping after failure, and template resolution
- The private-address block, including DNS-name forms and redirects
- Cron: next occurrence across a timezone and a DST boundary, and that a
  disabled workflow yields none
- An AI step writing both a `run_steps` row and an `ai_requests` row
- Cross-tenant isolation on every route

## Security considerations

- **HTTP actions are the dangerous part.** A workflow is user-supplied input
  containing a URL, executed by the server: that is server-side request forgery
  unless the destination is checked. Private, loopback, link-local and
  multicast addresses are refused, the resolved address is checked rather than
  the hostname, and redirects are not followed
- Response bodies are truncated before storage, so a workflow cannot fill the
  database by fetching something large
- AI steps go through `AiService`, so rule 8 is satisfied by construction
- Job claiming is transactional; a crash leaves a lock that ages out rather
  than a job that vanishes
- Workflow definitions are validated on write, so a malformed one is rejected
  at the API rather than by a worker at three in the morning

## Performance considerations

- The claim is one indexed query on `(status, run_at)` with a row lock
- The poller sleeps between empty polls, so an idle system is idle
- Step output is bounded before it is stored
- The scheduler ticks once a minute and enqueues, rather than holding timers
