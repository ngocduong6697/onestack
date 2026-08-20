# Review gates — TASK-016

## Before implementation

**1. What files will change?**
New: `backend/src/ai/stream.test.ts`, `backend/src/ai/adapters/streaming.test.ts`,
`backend/src/ai/providers.factory.test.ts`, `backend/src/common/logger.test.ts`,
`backend/src/audit/wiring.test.ts`, `frontend/src/app/login/login-form.test.tsx`,
`frontend/src/app/sign-out.test.tsx`. Modified: all three `vitest.config.ts`
files and `package.json` scripts, `.github/workflows/ci.yml`,
`frontend/src/lib/security-headers.ts` and its test, `frontend/next.config.ts`,
`README.md`.

**2. What database changes are required?**
None.

**3. What APIs are affected?**
None. The site's CSP narrows: `connect-src` loses an origin it no longer uses.

**4. What existing behavior could regress?**
Narrowing the CSP is the only behavioural change, and getting it wrong breaks
every request the browser makes. Its test asserts the directive exactly and
that no external host appears anywhere in the policy, so widening it again has
to be deliberate. Adding thresholds to `verify` makes the command slower and
can fail a build for a reason unrelated to correctness — which is the point,
but it is a new way for CI to go red.

**5. What tests are needed?**
The ones the measurement pointed at, in the order risk suggests rather than
percentage: `AiService.stream` first, because rule 8 rests on it.

**6. Are there simpler alternatives?**
Reporting coverage without a gate keeps CI simpler and lets coverage slide.
Chasing the percentage instead of the risk would reach a higher number by
testing bootstrap code.

## After implementation

**1. What changed?**
Coverage tooling in all three workspaces with thresholds enforced by
`yarn verify` and by CI. Seven new test files covering the streaming paths,
the provider factory, the log-level mapping, the audit catalogue's wiring, and
the frontend's two interactive components. The CSP's `connect-src` narrowed to
`'self'`, and the `apiOrigin` helper it depended on removed.

**2. What tests were added?**
61 — 53 backend, 8 frontend counted from the file list; the suites went from
592 to 645 and from 48 to 53.

**3. What tests were run?**
`yarn verify` passes with the gates enforced. Backend coverage rose from
92.67% to **95.38%** lines, 86.57% branches; frontend from 67.61% to **92.88%**
lines, 92.98% branches.

**4. What the measurement actually found.**
Two gaps were worth the task on their own:

- `AiService.stream` was at 64% and its usage recording was never executed by
  a test. TASK-011 added that recording and its review said rule 8 was "now
  complete" — true, but resting on inspection. It is now asserted for both a
  successful stream and one that breaks part way through.
- `login-form.tsx` was at **0%**. It is the only way into the application.

The frontend threshold was set at 80% before those tests were written, failed
at 67.61%, and was raised to 90% after — the honest order, rather than picking
a number the code already met.

**5. Any known limitations?**

- Coverage measures execution, not assertion. A file can be fully covered by
  tests that check nothing, and the thresholds cannot tell the difference.
- The `/api/[...path]` proxy is still not covered by a test; it is verified by
  the live run in TASK-015 only.
- `main.ts` and the schema files are excluded rather than tested.
- Ten catalogued audit actions remain deliberately unwired; the new test pins
  that list so it shrinks rather than drifts, but it does not shrink it.
- Branch coverage on the backend is 86.57%, the weakest of the four figures,
  and mostly error paths that need a failing database to reach.

**6. Does this follow CLAUDE.md?**

- Rule 1 — thresholds, gap selection and the debt items were approved first.
- Rule 2 — one dev dependency, `@vitest/coverage-v8`, for the measurement.
- Rule 3 — no logic added; the CSP's directive is now stated once, literally.
- Rule 5 — the CSP is narrower than it was, and asserted to name no external
  host.
- Rule 10 — this task is rule 10 applied to itself: the tests that existed are
  now measured, and the two that guarded a stated guarantee are written.
