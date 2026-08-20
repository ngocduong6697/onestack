# TASK-016 — Testing

Cross-cutting. Approved decisions: enforce a coverage floor just below today's
numbers, close the streaming and rule-8 gaps rather than chase the percentage,
and clear two items flagged in earlier reviews.

640 tests already exist. This task is not about writing more of them; it is
about knowing what they do not cover, and closing the gaps that carry a
guarantee.

## What the measurement showed

Backend: 92.67% lines, 86.33% branches, 85.5% functions.

| Lines | File                       | What is uncovered                              |
| ----- | -------------------------- | ---------------------------------------------- |
| 0%    | `common/logger.ts`         | The log-level mapping, entirely                |
| 42.9% | `ai/adapters/openai.ts`    | The streaming path                             |
| 62.2% | `ai/adapters/anthropic.ts` | The streaming path                             |
| 64.3% | `ai/ai.service.ts`         | `stream()` — **including its usage recording** |
| 69.5% | `automation/worker.ts`     | The poll loop                                  |
| 71.4% | `ai/providers.factory.ts`  | Which providers are built from which keys      |

The one that matters is `AiService.stream`. TASK-011 added usage recording to
it and TASK-011's review said rule 8 was "now complete". It is — but the code
that makes it so was never exercised by a test, so the claim rested on
inspection. That is the gap this task exists to close.

## Scope

- Coverage tooling in all three workspaces, with thresholds enforced in CI
- Tests for the streaming paths: both adapters and `AiService.stream`
- Tests for the worker loop, the provider factory and the logger
- A test asserting every catalogued audit action is actually wired
- Removing the CSP's now-unused API origin

## Non-goals

- Chasing the last few percent. Bootstrap code and unreachable error branches
  cost more to test than they find.
- End-to-end browser testing.
- Mutation testing, load testing, contract testing.
- Rewriting existing tests.

## Database changes

None.

## API changes

None.

## UI changes

`connect-src` in the site's CSP loses the API origin it no longer needs.

## Acceptance criteria

- `yarn verify` runs coverage and fails below 90% lines, 85% branches, 80%
  functions on the backend
- Coverage does not drop below those numbers on the current code
- `AiService.stream` is tested for both outcomes: usage recorded on a
  successful stream, and recorded as failed when the stream throws part way
- Both adapters' streaming paths assemble text and report final usage
- The provider factory is tested for each combination of keys present
- A test fails if a catalogued audit action has no call site
- The CSP contains no origin other than `'self'` in `connect-src`
- `yarn verify` passes

## Tests

Listed in scope; each is the point of the change rather than incidental.

## Security considerations

- The audit wiring test turns "we wired it" from a claim into an assertion —
  the same class of gap that let member removal go unaudited in TASK-014
- Removing the unused CSP origin narrows the policy to what is actually needed
  rather than leaving it correct by accident

## Performance considerations

- Coverage instrumentation makes the suite slower; it runs in CI and on demand
  rather than on every local `yarn test`
