# Security notes

## Outbound delivery (webhook + Discord action nodes)

The worker POSTs to user-supplied URLs (workflow webhook/Discord actions). All
outbound delivery goes through `@tripwire/utils` `guardedPost` — the SSRF
boundary:

- https only, rejected at config-save (shape) AND delivery time (resolved IP).
- The destination host is resolved and every returned address classified right
  before the POST (TOCTOU gate). Loopback, private, link-local, CGNAT,
  reserved, and cloud-metadata ranges are refused, v4 and v6.
- The fetch uses `redirect: "manual"`; a 3xx is returned, not followed, and
  recorded as a delivery failure. This setting is load-bearing: changing it to
  `redirect: "follow"` breaks the SSRF guard, because a post-resolution redirect
  to a blocked host connects after the delivery-time IP check already passed.
- 10s timeout, response body capped and discarded, never reflected to the user.
- Failures record the class (`blocked-destination`, `timeout`, …), never the URL.

Its adversarial test suite (`packages/utils/src/guarded-fetch.test.ts`) is the
proof the boundary holds — the happy path never exercises it.

### Signing + idempotency

The raw webhook is signed HMAC-SHA256 over `${timestamp}.${body}` when a
signing secret is set, sent as `X-Webhook-Signature: t=,v1=`. The signed string
is the exact wire body (serialized once). Every delivery carries `X-Delivery-ID`
and `Idempotency-Key` = the action row id, stable across retries, so a receiver
dedupes re-attempts. Discord ignores the idempotency key; a retry after a blip
Discord already accepted can double-post — acceptable for a notification
channel, documented in `docs/webhooks.md`.

## KNOWN GAP: no encryption at rest for stored secrets

Secrets (OAuth tokens, webhook/Discord URLs + signing secrets) are stored in
Postgres in **plaintext**. The masking in this feature is display + transport
only, not storage security.

**Single source of truth: `WEBHOOK-SECURITY-GAP.md` at the repo root.** That
file is the tracked item — status, scope (must cover OAuth tokens too), why it
is deferred rather than faked, and the trigger for doing it. Update it there,
not here.
