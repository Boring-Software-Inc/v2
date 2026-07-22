# TRACKED GAP: encryption at rest for stored secrets

Status: OPEN. Filed 2026-07-21 with the webhook/Discord action-node feature.

## What

Secrets are stored in Postgres in **plaintext**:

- GitHub OAuth `accessToken` / `refreshToken` / `idToken` (`account` table) —
  pre-existing.
- Webhook/Discord destination URLs and optional signing secrets (workflow
  definition jsonb) — added with the outbound-delivery feature.

## What is (and is not) solved

Solved this pass — display + transport masking:

- `.meta({ secret: true })` masks secret fields on the node face and panel.
- Set-only workflow save: the full URL/secret never returns to the client; a
  blank field keeps the stored value.
- Worker pino `redact` keeps URLs/secrets out of logs; run/activity views
  serialize only `{kind, status, recordedAt}`, never the payload.

NOT solved — at-rest encryption. A database read exposes every secret in
plaintext.

## Why it is deferred, not faked

Encrypting only the new webhook secret while OAuth tokens sit plaintext beside
it makes the security *story* incoherent — the next engineer reads "webhook
secrets are encrypted" and assumes tokens are too. At-rest encryption is a
cross-cutting change that must cover both. Faking partial encryption is worse
than a documented gap.

## Definition of done

- Envelope encryption (KMS-held key) or app-level AES with an env-held key.
- Covers OAuth tokens AND webhook secrets in one scheme.
- Key rotation story.
- Decrypt only at point of use (delivery, token refresh), never into logs.

## Trigger

Before onboarding any customer whose threat model includes database compromise.
For the current two-founder pre-launch posture, the documented masking is the
accepted interim.
