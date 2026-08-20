# TASK-009 — AI provider abstraction

Phase 3. Depends on TASK-004. Approved decisions: all three providers
implemented (Anthropic, OpenAI, Google), generation with streaming and usage
reporting, and a scope covering the registry, cost, configuration and an
endpoint.

## Goal

One way to ask a model for text, whichever vendor answers, with the tokens and
the money it cost attached to the result — which is what CLAUDE.md rule 8
needs before anything can record it.

## Scope

- `AiProvider` interface: `complete()` and `stream()`
- Adapters for Anthropic, OpenAI and Google, each on its vendor's official SDK
- A model registry carrying provider, context window and per-million pricing,
  with the date each price was checked and the source it came from
- Cost computed from normalised usage, in cents, as integers
- Environment configuration: keys are server-side only, validated at boot,
  and a provider whose key is absent is unavailable rather than broken
- `POST /orgs/:orgId/workspaces/:workspaceId/ai/complete`, workspace-scoped

## Non-goals

- Persisting usage and cost. The result carries both; storing them is TASK-010.
- Tool use, structured output, vision, batching, caching control. Offered and
  declined for now; the interface leaves room.
- Prompt management, agents, conversations — TASK-011 and later.
- Model fallback and routing between providers.
- Any UI.

## Database changes

None. This task computes cost and returns it; TASK-010 owns the tables.

## API changes

`POST /orgs/:orgId/workspaces/:workspaceId/ai/complete`, permission
`ai:invoke`. Body: `model`, `messages`, optional `system`, `maxTokens`,
`stream`. Returns the text, normalised usage, and the cost in cents.

`GET /orgs/:orgId/workspaces/:workspaceId/ai/models`, permission `ai:read` —
the registry, filtered to providers that are actually configured.

## UI changes

None.

## Acceptance criteria

- One interface serves all three providers; a caller changing `model` between
  vendors changes nothing else about the call
- Usage is normalised: input, output, and where the vendor reports them, cache
  read and cache write tokens
- Cost is computed in integer cents from the registry, never a float, and a
  model missing from the registry is an error rather than a silent zero
- A provider without a configured key reports itself unavailable, and asking
  for its models returns 404 rather than a crash at call time
- No API key ever appears in a response, a log line, or an error message
- Streaming yields text incrementally and ends with the same usage and cost a
  non-streamed call would report
- Every vendor's errors map onto the same domain errors: rate limit, invalid
  request, provider unavailable
- Tests never make a real network call
- `yarn verify` passes

## Tests

- Cost arithmetic: each model, zero usage, cache tokens, rounding of a
  fractional cent, and an unknown model raising rather than returning zero
- Registry: pricing present for every listed model, no duplicate ids, every
  entry naming a provider that exists
- Each adapter against a fake vendor client: request shape, usage
  normalisation, error mapping, and streaming assembly
- Availability: a provider with no key is excluded from the registry listing
  and refuses to be constructed
- The endpoint end to end with a stub provider, including that the response
  carries cost and never a key

## Security considerations

- Keys come from the environment, are validated at boot, and are never
  returned, logged, or included in an error. The adapters take an injected
  client so that no test needs a real key
- The endpoint is workspace-scoped behind the existing guards, so prompts
  cannot cross a tenant boundary
- `maxTokens` is capped by the registry's per-model limit, so a caller cannot
  ask for an unbounded and expensive generation
- Prompt content is not logged. It is customer data, and an AI request log is
  the easiest place to leak it by accident
- Vendor errors are mapped rather than passed through, so a provider's error
  body cannot carry internals into a response

## Performance considerations

- One client per provider, constructed once and reused, so connections are
  pooled rather than rebuilt per request
- Streaming is the default path for large `maxTokens`, which is what keeps a
  long generation from hitting an HTTP timeout
- Cost is arithmetic on integers, computed after the call, and adds nothing
  measurable
