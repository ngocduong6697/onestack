# TASK-017 — Security hardening

Phase 6. Approved decisions: make proxy trust explicit and tested, document the
CSP's `unsafe-inline` honestly rather than pretending it away, and add
dependency and secret scanning while removing the throttle escape hatch.

The gaps here were recorded across sixteen review gates rather than guessed at.

## Goal

Close the security gaps that deployment would otherwise turn from theoretical
into real, and stop claiming protection the code does not provide.

## Scope

- `TRUST_PROXY` configuration, untrusted by default, so the real client IP is
  read only when a proxy genuinely sits in front
- Rate limiting keyed on that IP, so it counts clients rather than proxies
- Removing `THROTTLE_DISABLED` and replacing it with a test-only override
- `yarn npm audit` and a secret scan in CI
- `docs/SECURITY.md`: what is protected, what is not, and why

## Non-goals

- CSP nonces. Offered and declined; the cost is every rendering path and the
  gain is contained by there being one page.
- CSRF tokens. Offered and declined: `SameSite=Lax` already blocks cross-site
  form posts in every current browser.
- Row-level security, declined in TASK-004.
- Password reset, which needs an email provider.
- Audit tamper-proofing, penetration testing, WAF rules.

## Database changes

None.

## API changes

None. Behaviour changes only in how the client IP is determined.

## UI changes

None.

## Acceptance criteria

- With `TRUST_PROXY=0` — the default — a forwarded header is ignored and the
  socket address is used, because a client that sets its own
  `X-Forwarded-For` is lying
- With `TRUST_PROXY=1`, the last hop is trusted and the client's real address
  is used for rate limiting
- Rate limiting counts two clients behind one proxy separately
- `THROTTLE_DISABLED` no longer exists anywhere in the source
- Tests that are not about rate limiting still pass without it
- CI fails on a dependency advisory at high severity or above
- CI fails if something that looks like a credential is committed
- The secret scan does not fire on the example file, which contains names
  without values
- `docs/SECURITY.md` states what is not protected as plainly as what is
- `yarn verify` passes

## Tests

- The trust-proxy setting derived from configuration, including the default
- Rate limiting distinguishing two forwarded clients, and ignoring the header
  when the proxy is untrusted
- The secret scanner against a fixture containing a key, and against
  `.env.example`, which must not fire

## Security considerations

- **Trusting a proxy that is not there is worse than not trusting one.** Any
  client could then claim any IP and evade a rate limit or poison an audit
  entry. The default is therefore zero, and the value counts hops rather than
  being a boolean
- Removing `THROTTLE_DISABLED` removes a way to turn off a security control by
  environment variable. It was gated to non-production, which is one
  misconfiguration away from not being
- A secret scan in CI catches the mistake that no amount of review reliably
  does

## Performance considerations

- None meaningful; `trust proxy` is a header read per request
