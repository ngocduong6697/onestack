# Review gates — TASK-009

## Before implementation

**1. What files will change?**
New: `backend/src/ai/` (provider interface, registry, cost, three adapters,
service, controller, module, providers factory, tests) and `shared/src/ai.ts`.
Modified: `permissions.ts` (two entries), `config/env.ts` (three optional
keys), `app.module.ts`, both barrels, `README.md`, `.env.example`,
`docs/BACKLOG.md`.

**2. What database changes are required?**
None. This task computes cost and returns it; TASK-010 owns the tables.

**3. What APIs are affected?**
Two routes added under an existing scoped prefix. Nothing existing changes.

**4. What existing behavior could regress?**
Two risks. `config/env.ts` is read at boot by every deployment, so a mistake
there stops the API starting — mitigated by making all three keys optional,
which is also the intended behaviour. And `permissions.ts` is now touched by a
fifth task; its exhaustive test catches any drift, as it has four times before.

**5. What tests are needed?**
Cost arithmetic first, because it is the number a bill is built from and it has
real edge cases: sub-cent amounts, cache buckets billed at their own rate, and
an unknown model that must raise rather than cost nothing. Then each adapter
against a fake vendor client — request shape, usage normalisation, error
mapping — with no test permitted to touch the network. Then the service's
routing and its per-model token ceiling, and the endpoint end to end.

**6. Are there simpler alternatives?**
One adapter now with a seam for the rest was offered and declined in favour of
all three. Putting pricing in the database would let it be corrected without a
deploy, and would also let it be wrong with no review; in code it moves through
the same pull request as everything else. Passing vendor errors straight
through would be less code and would let a vendor's error body carry request
internals into a response.

## After implementation

**1. What changed?**
New `backend/src/ai/`: `provider.ts` (the interface), `registry.ts` (models and
prices), `cost.ts`, `adapters/anthropic.ts`, `adapters/openai.ts`,
`adapters/google.ts`, `providers.factory.ts`, `ai.service.ts`,
`ai.controller.ts`, `ai.module.ts`. New `shared/src/ai.ts`. Modified as listed
above.

Each adapter is written against its own vendor's official SDK — Anthropic's
against `@anthropic-ai/sdk`, OpenAI's against `openai`, Google's against
`@google/genai`. Their APIs were read from the installed type definitions
rather than recalled, and current prices were fetched from each vendor's
pricing page rather than remembered.

**2. What tests were added?**
60, taking the suite from 261 to 321. Cost and registry: 16, including that
sub-cent amounts are kept exactly while cents round for display, that cache
reads bill at the cache rate rather than the input rate, and that an unknown
model raises. Adapters: 20 against fake clients, covering request shape,
usage normalisation, stop-reason mapping, streaming assembly, and that a
vendor's error message never survives translation. Service: 11, including
per-model token capping and routing by provider. Endpoint: 13.

**3. What tests were run?**
`yarn verify` passes — 321 backend, 7 shared, 9 frontend. Against a running
API: with no keys the process booted, logged `AI providers configured: none`,
returned `[]` from `/ai/models`, and answered `/ai/complete` with
`"The anthropic provider is not configured on this deployment"`. With a key
set, three Anthropic models were listed, and the key appeared **zero** times in
responses and zero times in the log.

**4. Any known limitations?**

- **No live vendor call has been made.** There are no API keys in this
  environment, so every adapter is verified against the vendors' published
  type definitions and fake clients, not against their servers. The request
  shapes are right by construction; whether each vendor accepts them in
  practice is unproven until someone runs it with a real key.
- Model ids for OpenAI and Google were taken from their pricing pages. They
  follow each vendor's naming convention, but only a live call confirms them.
- Prices go stale. Each entry records when it was checked; nothing warns when
  that date gets old.
- Streaming exists on the interface and in all three adapters, but the endpoint
  only exposes `complete`. Nothing consumes a stream until TASK-011.
- No tool use, structured output, vision, batching or prompt-cache control.
- Nothing is persisted, so rule 8 is half-satisfied: cost is computed and
  returned on every request, and TASK-010 must record it.

**5. Any technical debt?**

- The OpenAI adapter casts the Responses result through a local shape because
  the SDK's union is wider than this narrow use. It is honest about what it
  reads, but it is a cast, and it should go once the interface grows.
- `AiService` logs a one-line summary per request. That is the seam TASK-010
  will replace with a real record; it should not stay as both.
- The registry mixes catalogue and pricing. Once a second thing needs the
  catalogue, pricing should split out.

**6. Does this follow CLAUDE.md?**

- Rule 1 — providers, capabilities and scope were approved before any code.
- Rule 2 — three dependencies, one per approved provider, each the vendor's
  official SDK.
- Rule 3 — one interface, one cost function, one registry; no vendor logic
  leaks into the service.
- Rule 4 — no UI.
- Rule 5 — keys are server-side, optional, never logged and never returned;
  vendor errors are mapped rather than passed through; prompts are not logged.
- Rule 6 — the request body validates through the pipe.
- Rule 8 — cost is computed for every request and returned with it. Recording
  it is TASK-010, and until that lands the rule is only half met.
- Rule 10 — every module added ships with tests, and none of them can reach a
  vendor.
