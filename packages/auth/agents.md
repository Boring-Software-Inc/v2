# Auth Scope
Rules for `packages/auth/**`. (Owner-authorized addition to the §3 layout —
see DECISIONS.md "packages/auth".)
- `server.ts`: the Better Auth instance factory + fail-closed posture guard.
  Mounted by the WEB head's nitro server route; sessions live in @tripwire/db.
- `client.ts`: the browser auth client. MUST NOT import server.ts or anything
  server-only — it ships in the client bundle.
- §10 law unchanged: GitHub identity in exactly two places (account,
  forge_identities); user.id is UUIDv7; contributors never authenticate.
