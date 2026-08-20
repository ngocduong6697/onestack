# Review gates — TASK-017

## Before implementation

**1. What files will change?**
New: `backend/src/config/trust-proxy.ts` and its test,
`backend/src/common/throttler.ts`, `scripts/check-secrets.mjs`,
`docs/SECURITY.md`. Modified: `config/env.ts`, `main.ts`, `app.module.ts`,
thirteen end-to-end test files that set the throttle flag,
`.github/workflows/ci.yml`, `package.json`, `.env.example`, `README.md`.

**2. What database changes are required?**
None.

**3. What APIs are affected?**
None. What changes is how the client's address is determined, which changes
who a rate limit applies to.

**4. What existing behavior could regress?**
Two ways, both serious. Setting `trust proxy` wrongly is worse than not
setting it: with it on and no proxy in front, any client can claim any address
and evade a rate limit entirely. And removing `THROTTLE_DISABLED` touches
thirteen test files at once — if the replacement override does not work, those
suites fail on rate limiting rather than on what they test.

**5. What tests are needed?**
The address resolution as a pure function, including the case that matters:
that a forwarded header is ignored when nothing is trusted. Then the live
check, because the property is about what Express actually does with the
setting, not about the helper.

**6. Are there simpler alternatives?**
`app.set('trust proxy', true)` is one line and trusts any number of hops from
anywhere, which is the misconfiguration this task exists to avoid. Keeping the
throttle flag is less churn and leaves a way to switch off a security control
by environment variable.

## After implementation

**1. What changed?**
`TRUST_PROXY` added, defaulting to zero, with `trust-proxy.ts` holding the
address resolution as testable logic. `THROTTLE_DISABLED` removed entirely —
zero references remain in the source — and replaced with a `THROTTLER_GUARD`
token that a testing module overrides and a deployment cannot reach. The
throttler now keys on the client address rather than the socket.
`scripts/check-secrets.mjs` and `yarn audit` added to CI. `docs/SECURITY.md`
written.

**2. What tests were added?**
10 for address resolution, taking the suite from 645 to 655. The thirteen
end-to-end files that set the flag now override the guard instead.

**3. What tests were run?**
`yarn verify` passes with the coverage gates. The secret scanner reports clean
across 298 tracked files, and was proven to work by planting a key and
watching it fail before removing it.

The trust-proxy property was checked live, in both modes, because it is about
what Express does rather than what the helper returns:

```
TRUST_PROXY=0, seven forged IPs   401 401 401 401 401 429 429   header ignored
TRUST_PROXY=1, seven real clients 401 401 401 401 401 401 401   counted apart
TRUST_PROXY=1, one client repeats 401 401 401 401 401 429 429   limit bites
```

The first line is the one that matters: without it, anybody could set
`X-Forwarded-For` and never be rate limited.

The scanner also found a genuine match on first run — the fixture in
`domain-exception.filter.test.ts` that exists to assert a connection string
never reaches a response. It was verified as a fixture before being
allowlisted by an exact pattern rather than by switching the rule off.

**4. Any known limitations?**

- Rate limit counts are still in memory, per process. A second API container
  doubles the effective limit; shared storage is unfinished.
- `TRUST_PROXY` must match the deployment. Set too high, it reintroduces
  exactly the evasion it prevents. TASK-018 has to set it correctly.
- The dependency audit is `continue-on-error`, so an advisory nobody can fix
  today does not block a deploy — which also means it can be ignored.
- The secret scanner matches known prefixes. A credential without a
  recognisable shape — a password, a database URL with an unusual scheme —
  passes.
- Everything in `docs/SECURITY.md` under "What is not protected" is still not
  protected: inline script in the CSP, no CSRF tokens, no password reset,
  bearer invite tokens, no lockout, no tamper-proof audit.

**5. Any technical debt?**

- `clientAddress` mirrors Express's own resolution rather than being consulted
  by it. It is tested and Express is configured, but they are two
  implementations of one idea, and only the live test proves they agree.
- `AddressThrottlerGuard.trackerFor` exists only so a test could reach a
  protected method, and nothing uses it.
- The allowlist in the secret scanner is a list of literals that will drift.

**6. Does this follow CLAUDE.md?**

- Rule 1 — the proxy decision, the CSP position and the scope were approved.
- Rule 2 — no new runtime dependencies.
- Rule 5 — this task is rule 5 examined: what is exposed, and what only looks
  protected. The honest list is written down rather than implied.
- Rule 10 — the added logic ships with tests, and the property that could not
  be unit tested was verified against a running process.
