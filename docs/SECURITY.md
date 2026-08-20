# Security

What this system protects, what it does not, and why. The second list matters
more than the first: a protection you believe in but do not have is worse than
one you know you are missing.

## Identity

Passwords are argon2id at OWASP's minimum parameters. Sessions are opaque
256-bit tokens in an httpOnly, SameSite=Lax cookie, `Secure` in production;
only a SHA-256 of the token is stored, so reading the database grants nothing
presentable. Logging out deletes the row, so revocation is immediate. Changing
a password requires the current one and revokes every other session.

Login answers a wrong password and an unknown address identically, and spends
the same time on both — measured at a 0.31 ms difference over 40 samples, so
neither the body nor the clock reveals which accounts exist.

## Tenancy

Every scoped route resolves membership in a guard, and every query filters on
the workspace or organization as well as the record id. A non-member receives
**404, not 403**, because 403 confirms the thing exists.

There is no database-level backstop. Row-level security was considered and
declined in TASK-004: isolation rests on the guard and on every query being
written correctly. A missing `where` clause is a data leak, and only review and
tests prevent one.

## Rate limiting

120 requests a minute per client, 5 login attempts and 3 registrations.

Limits are keyed on the client's address, which behind a proxy is only correct
if `TRUST_PROXY` is set to the number of hops actually in front. **It defaults
to zero and should stay there unless a proxy really is in front**: trusting a
proxy that is not there is worse than trusting none, because a client can then
set its own `X-Forwarded-For` and claim any address.

Counts are held in memory, per process. A second API container doubles the
effective limit. Shared storage is unfinished work.

## What the AI and automation layers do not send

Prompts and completions are never logged or stored — the usage table holds
tokens and cost only. API keys are server-side, optional, and never appear in a
response, a log line or an error; vendor errors are translated rather than
passed through.

HTTP actions in a workflow are checked against the **resolved** address, not
the hostname, and refuse loopback, RFC 1918, link-local — including
`169.254.169.254` — carrier-grade NAT, multicast and their IPv6 forms.
Redirects are not followed, because a redirect is a second destination nobody
checked.

## Audit

Important actions are recorded with who, what, which record and which fields
changed, redacted centrally so a call site cannot leak a token. Recording never
throws: an audit write that fails a payment is worse than a missing entry, so a
gap is possible and is logged as `AUDIT GAP`.

The log is readable by admins and owners only. It is **not tamper-proof** —
anything with database access can delete from it.

## What is not protected

- **`script-src 'unsafe-inline'`.** Next injects an inline bootstrap script, so
  the site's CSP allows inline script. This means CSP does not contain an XSS;
  it only limits where scripts may be loaded from. Removing it requires a
  per-request nonce threaded through middleware and every render, which was
  considered and declined. Everything else in the policy is tight, and
  `connect-src` is `'self'` with no external host anywhere.
- **No CSRF tokens.** `SameSite=Lax` blocks cross-site form posts in every
  current browser, which is the attack this would prevent. An older browser
  would not be protected.
- **No password reset.** An owner who forgets their password cannot recover
  without a database edit. It needs an email provider, and there is none.
- **Invite tokens are bearer credentials.** Whoever holds the link joins, even
  if their account uses a different address. They are single-use and expire in
  seven days.
- **No account lockout.** Repeated failures are rate limited, not locked out,
  so a slow distributed attempt is not stopped by this alone.
- **No secret rotation, no encryption at rest beyond what the database
  provides, no WAF, no penetration test.**

## In CI

- `yarn secrets:check` — tracked files scanned for credential-shaped strings,
  with placeholders allowlisted explicitly by pattern
- `yarn audit --level high` — dependency advisories, advisory rather than
  blocking, so a transitive advisory nobody can fix today does not stop a
  deploy while still appearing in the log
