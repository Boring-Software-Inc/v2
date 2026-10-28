# GitCafe sign-in: opt-in backend

This slice authenticates a person through GitCafe OIDC. It does not enable the
GitCafe catalog entry, add a sign-in button, request repository permissions, or
establish installation ownership. Historical OpenGit keeps its provider ID,
issuer, and configuration.

The web auth head registers the provider only when `GITCAFE_SIGN_IN_ENABLED=true`
and `GITCAFE_OAUTH_CLIENT_ID` is nonempty. A client ID alone does not enable it.
Invalid enablement or a missing enabled client ID refuses auth initialization.
No client secret is accepted. The API head only reads shared sessions and needs
no GitCafe OAuth configuration; MCP continues to verify Tripwire-issued grants.

Use the existing `POST /api/auth/sign-in/social` endpoint with
`provider: "gitcafe"` for an explicitly configured backend test. The callback is
`/api/auth/callback/gitcafe`; staging must register exactly
`https://staging.tripwire.sh/api/auth/callback/gitcafe`. Registration and step-up
confirmation remain manual and are owned by the parent task.

## Identity and account binding

- Issuer: exactly `https://git.cafe`. Authorization, token, and JWKS URLs are
  pinned to the endpoints published in GitCafe's current OIDC guide. There is
  no configurable alternative host or discovery-based downgrade.
- The authorization request always uses `openid profile email`, a server nonce,
  and S256 PKCE. Caller scopes and extra authorization parameters cannot add
  API authority or change the protocol fields.
- ID tokens are mandatory. Better Auth's exported `validateToken` verifies
  RS256 against the pinned JWKS and checks issuer, audience, required registered
  claims, expiry, and not-before. The provider additionally validates the
  contracts schema, exact single-client audience, authorized party when present,
  nonce, access-token hash, issued-at age, and `email_verified === true`.
- Better Auth's shared callback validates state and its signed browser cookie.
  A separate server-created nonce record is consumed atomically through the
  database adapter before a verified profile can create a session. Raw ID-token
  sign-in is unsupported, so caller-provided nonces cannot replace browser state.
- Both implicit and explicit linking involving GitCafe are denied, including
  another trusted provider linking into an existing GitCafe user. Existing
  non-GitCafe linking behavior is retained. A returning subject selects its
  original local account even if its email changes to another local user's email.
- `account.provider_id = gitcafe`; `account.account_id = sub`. The auth hook
  mirrors `forge_identities.external_id = sub` and `username = preferred_username`
  from the verified callback profile. A handle rename updates that same identity;
  display name is never used as a handle. An existing identity owned by another
  local user cannot be reassigned. This explicit backend path can persist a
  GitCafe identity while the ingest/catalog capability remains unavailable.
- Verified profiles stay in a request-scoped weak map until account hooks run.
  GitCafe access tokens, refresh tokens, and ID tokens are cleared before account
  writes. The sign-in grant cannot later be repurposed as an installation grant.

The handoff contract is `GitCafeIdentity` from `@tripwire/contracts`:
`{ issuer, subject, handle }`. `subject` is GitCafe's OIDC account subject; it is
not an actor ID, organization ID, or installation ID. The claims schema is a
shape validator, not a cryptographic verifier.

## Installed library audit

Audited the installed `better-auth@1.7.12`, `@better-auth/core@1.7.12`, and
`@better-auth/drizzle-adapter@1.7.12` distribution source, rather than inferring
validation from documentation:

- `better-auth/dist/api/routes/sign-in.mjs`: redirect sign-in generates state and
  a nonce; raw ID-token sign-in requires an explicit verifier, which this
  provider does not expose.
- `better-auth/dist/oauth2/state.mjs` and `dist/state.mjs`: a database-backed
  callback checks state existence, expiry, and the signed browser cookie. Its
  state read and delete are separate operations, so state alone is not an atomic
  replay barrier.
- `better-auth/dist/api/routes/callback.mjs` and `dist/oauth2/callback.mjs`:
  supplied authorization-response issuer is checked before exchange, the
  server nonce is passed to `getUserInfo`, and immutable account selection uses
  the provider's `accountSubject`.
- `@better-auth/core/dist/oauth2/create-authorization-url.mjs`: computes the
  SHA-256 PKCE challenge and writes `code_challenge_method=S256`.
- `@better-auth/core/dist/oauth2/validate-authorization-code.mjs` and
  `token-endpoint-auth.mjs`: public authentication sends the client ID and PKCE
  verifier without a client secret or Basic authentication. Token requests
  refuse redirects.
- `@better-auth/core/dist/oauth2/verify.mjs`: `validateToken` reaches
  `verifyJwsToken` and JOSE `jwtVerify` with the configured algorithms and claim
  options. JWKS fetching refuses redirects and verification waits are bounded.
- `better-auth/dist/db/internal-adapter.mjs`: `consumeVerificationValue` delegates
  to `consumeOne`; the PostgreSQL Drizzle implementation in
  `@better-auth/drizzle-adapter/dist/index.mjs` uses `DELETE ... RETURNING` to
  select one winner across auth instances.
- `better-auth/dist/plugins/generic-oauth/index.mjs`: its default profile path
  can fall back to userinfo if the exchange omits an ID token. The GitCafe
  provider instead uses the existing OAuth primitives with mandatory signed
  claims and a pinned issuer/JWKS. OpenGit's generic plugin remains unchanged.
- `better-auth/dist/oauth2/link-account.mjs`: verified remote email can permit
  implicit linking even without a trusted-provider entry. Merely excluding
  GitCafe from `trustedProviders` is insufficient; `user.validateUserInfo`
  rejects linking before account creation and rechecks returning OAuth users.
- `better-auth/dist/api/routes/account.mjs`: direct ID-token linking has a
  separate account-create path that bypasses `user.validateUserInfo`. The
  account-create hook independently blocks adding any provider to a GitCafe user.

Official references checked on 2026-10-27 Pacific:
[GitCafe sign-in](https://git.cafe/docs/integrations/sign-in-with-gitcafe),
[Better Auth Generic OAuth](https://www.better-auth.com/docs/plugins/generic-oauth),
[Better Auth OAuth](https://www.better-auth.com/docs/concepts/oauth), and
[Better Auth users/accounts](https://www.better-auth.com/docs/concepts/users-accounts).

## Verification and remaining live work

`gitcafe-oidc.integration.test.ts` exercises the actual HTTP sign-in/callback,
session cookies, and database hooks against real throwaway PostgreSQL. An
in-process transport supplies generated RSA-signed adversarial tokens and JWKS;
these are protocol test inputs, not captured GitCafe fixture evidence. It checks
the public token request and PKCE relationship; disabled runtime configuration;
state/cookie failures; sequential replay; a forced concurrent state-read race
across two auth instances; signed issuer/audience/nonce/authorized-party/hash
failures; signature/algorithm/required-claim/time/email failures; token omission;
handle rename; both directions of same-email account binding; explicit linking;
direct ID-token bypass, missing/expired nonce records, and conflicting identity
ownership. It also verifies sign-in tokens are absent in storage.

Local verification against parent head `66da37df`:

- Focused GitCafe integration suite: 44 passed, 221 assertions, real PostgreSQL.
- Full `bun test`: 3,968 passed across 334 files, 21 snapshots, zero failures.
- Repository `bun run typecheck` and `bun run typecheck:ts5`: all workspaces pass.
- `bun run check`: 1,315 files checked; boundary and changed-line anti-slop gates pass.
- Comment gate: new comments use TSDoc for protocol and security constraints.

Real staging sign-in has not been exercised. Before enabling a visible sign-in
control, complete the exact registered redirect through the manual GitCafe
consent flow, verify the returned signed claims and subject/handle mapping,
returning sign-in, cookie behavior, rejection paths, and sign-out. Do not retain
live tokens in evidence or fixtures.

Installation claims need a separate API-linking grant. The parent has identified
`repo:metadata:read` with resource `https://git.cafe/api`, followed by a
same-person `userinfo.sub` check, `/api/auth/principal` actor resolution, and
installation/org membership proof. No person userinfo/principal pair has been
captured yet. This slice requests no API resource, invents no organization
scopes, and makes no claim that the OIDC subject equals an actor ID.

No frontend component or visual asset changed, so before/after media is not
applicable to this backend slice.
