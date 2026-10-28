# GitCafe sign-in: opt-in backend

This slice authenticates a person through GitCafe OIDC. It does not enable the
GitCafe catalog entry, add a sign-in button, request repository permissions, or
establish installation ownership. Historical OpenGit keeps its provider ID,
issuer, and configuration.

The web auth head registers the provider only when `GITCAFE_SIGN_IN_ENABLED=true`
and `GITCAFE_CLIENT_ID` is nonempty. A client ID alone does not enable it.
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

## Durable account binding and staging rollout

Migration 0046 adds a unique account key only for `provider_id = 'gitcafe'`.
GitHub, historical OpenGit, and credential accounts retain their current
constraints. The GitCafe account-create hook passes its verified identity through
private symbol metadata, which the adapter removes before storage. The adapter
claims the identity with an owner-conditional upsert and inserts the account in
one database transaction. A foreign identity owner stops the insert; an account
insert failure rolls back the identity claim as well. The create-after hook no
longer decides GitCafe ownership after the account has committed.

The global Drizzle transaction setting stays off. Better Auth creates the user
before this account-only transaction, and personal-org creation uses the original
database handle. A failed or losing signup can therefore leave a committed user
without an account or session; the personal-org after hook may not run on that
failed signup. This fix deliberately retains the user rather than guessing
whether another request has started using it.
GitCafe's user after-hook checks for a committed account before provisioning an
org: Better Auth can run that hook after account creation fails. This prevents
the losing flow from competing with the successful flow for its personal-org slug.
Both verified email variants of a racing subject subsequently select the one
successful account owner. No process-local lock establishes ownership.

Staging currently has migrations through 0044, the global events delivery index,
and no GitCafe accounts. Its older API must keep that events index until compatible
ingest code is deployed. Do not run the full migrator solely to test OIDC: that
would also apply 0045. Keep GitCafe sign-in disabled until the index below and the
reviewed auth code are both present. The parent owns staging deployment and live
login; this implementation does not access staging credentials or production.

Against the verified staging database only, preapply this exact statement from
`packages/db/drizzle/0046_gitcafe_account_binding.sql`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "account_gitcafe_subject_unique" ON "account" USING btree ("provider_id","account_id") WHERE "account"."provider_id" = 'gitcafe';
```

`IF NOT EXISTS` permits a later normal migration after preapply; it does not prove
that an existing index has the right definition. Run this equivalence check and
require exactly one row with `equivalent = true`:

```sql
SELECT
  i.indisunique AND i.indisvalid AND i.indisready
  AND i.indrelid = 'public.account'::regclass
  AND am.amname = 'btree'
  AND i.indnkeyatts = 2 AND i.indnatts = 2
  AND pg_get_indexdef(i.indexrelid, 1, true) = 'provider_id'
  AND pg_get_indexdef(i.indexrelid, 2, true) = 'account_id'
  AND pg_get_expr(i.indpred, i.indrelid) = '(provider_id = ''gitcafe''::text)'
  AS equivalent
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_am am ON am.oid = c.relam
WHERE i.indexrelid = to_regclass('public.account_gitcafe_subject_unique');
```

Do not insert a 0046 migration-journal row during preapply. Drizzle advances by
timestamp; recording 0046 early could make it skip 0045 later. Confirm the journal
still ends at 0044 and `events_delivery_id_unique` remains present, with
`events_forge_delivery_id_unique` absent. Once compatible ingest code is deployed,
the normal migrator applies 0045 and records 0046, retaining the preapplied index.
0045 and its existing snapshot remain unchanged. The 0046 SQL, journal entry,
snapshot, and schema are included together.

An installation with duplicate GitCafe account keys fails index creation without
changing ownership or deleting rows. Review such data before enabling sign-in;
the migration does not choose an owner or merge users. Index creation takes a
write lock on `account` while building it, so the parent should apply it before
the staging login attempt. This standalone preapply and later migration sequence
is covered against real PostgreSQL, including retained GitHub/OpenGit duplicates.

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
- `better-auth/dist/db/with-hooks.mjs`: create-before hook data is spread before
  adapter creation, preserving private symbol metadata. Create-after hooks run
  after the adapter write and cannot establish rollback safety. The Drizzle
  adapter defaults to `transaction: false`; its fallback transaction receives
  the same adapter instance. The GitCafe wrapper changes that instance's create
  operation only, so the account/identity write uses the real transaction while
  other provider and user/org operations retain their existing behavior.

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

Security-review fix against parent head `569be2ee`:

- The new independent-flow regression failed on the parent with two persisted
  accounts for one subject. The strengthened foreign-identity regression also
  failed with one persisted account after rejection.
- Focused OIDC and migration suites: 51 passed, 304 assertions, real PostgreSQL.
  This includes distinct valid states/nonces with different verified emails,
  returning logins for both emails, rollback after a unique-index conflict,
  foreign identity ownership, and unchanged GitHub/OpenGit account persistence.
- Full `bun test`: 4,012 passed across 336 files, 21 snapshots, zero failures.
- Repository `typecheck` and `typecheck:ts5`, Biome, boundaries, and changed-line
  anti-slop checks pass. New comments use TSDoc for security and test constraints.
- Drizzle regeneration reports no schema changes. Comparing 0045 and 0046
  snapshots finds only the new partial unique index plus snapshot metadata.
- The migration test restores 0044, checks duplicate-owner failure without data
  loss, preapplies the exact standalone DDL twice, validates index equivalence,
  confirms unchanged events indexing and journal, then runs normal migrations.

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

## Connect-only authorization proof foundation

The existing configured GitCafe auth client also registers the private grant
protocol. There is no second runtime switch, UI change or catalog activation.
`POST /api/auth/gitcafe/connect` accepts exactly `{ orgId,
intendedInstallationId }`. It requires an explicitly same-origin request, an
approved authoritative Tripwire session without impersonation, and fresh
`connections:manage` permission for that org. It returns an authorization URL;
no installation is claimed. The intended installation is a binding constraint,
not evidence that the caller owns it.

The authorization URL uses the existing registered callback, S256 PKCE, a server
OIDC nonce, fixed `openid profile email repo:metadata:read` scopes and resource
`https://git.cafe/api`. Request input cannot supply protocol or permission fields.
The before-hook reads persisted server flow metadata to classify the callback,
then calls exported `parseState` for cookie/expiry validation and rechecks the
same session, user, approval and org permission. A separate atomic nonce prevents
a two-reader state race from producing two grants. A classification marker lasts
as long as Better Auth's state so replay/error handling cannot enter sign-in;
missing markers with surviving connect server context also fail closed. Other
provider callbacks reject connect state. Ordinary sign-in state is read without
consumption during classification, including untrusted `additionalData` that
attempts to impersonate server context.

`verifyGitCafeClaims` is now the explicit shared signed-claim verifier; the
sign-in nonce barrier, fixed scopes, stripped account tokens and all existing
identity/link/failed-signup hooks remain intact. The grant additionally requires
a live same-token userinfo subject equal to the verified ID-token subject and a
principal response with a separate actor ID. Missing, narrowed/excess scopes,
non-Bearer or expired tokens and unavailable/mismatched person reads fail closed.
The callback returns only `{ proofHandle }` with `Cache-Control: no-store` and
never redirects through or issues a login session.

The encrypted proof is bounded by its original five-minute flow expiry and token
expiry, uses no refresh token, and is stored only in Better Auth's verification
store. `auth.api.consumeGitCafeConnectProof` is a **pathless server-only endpoint**
with no HTTP URL. Trusted code supplies session headers and `{ proofHandle,
orgId, intendedInstallationId }`; it rechecks approval, fresh session and current
org permission, validates the encrypted binding and atomically consumes one
proof. The returned credential must stay inside trusted server code. Auth uses
Better Auth's encryption with a purpose-separated HMAC-derived key; API/worker
transport is not implemented, and worker cannot import auth to decrypt it.

Installed 1.7.12 source additionally inspected for this slice:
`dist/api/dispatch.mjs` (before-hook short circuit and cookie/header propagation),
`dist/api/state/oauth.mjs` (`addOAuthServerContext`/`getOAuthState`),
`dist/oauth2/state.mjs` (`generateState`/`parseState`), `dist/state.mjs`
(database `auth-state:` identifier and cookie/expiry checks),
`dist/api/routes/session.mjs` (`getAuthoritativeSessionFromCtx` bypasses cached
sessions), `@better-auth/core/dist/api/index.mjs`
(`createAuthEndpoint.serverOnly`), and `dist/crypto/index.mjs`
(authenticated XChaCha20-Poly1305 encryption). Classification deliberately depends
on the installed `auth-state:` storage convention; re-audit it on library upgrade.
Official contracts checked on 2026-10-27:
[GitCafe OIDC](https://git.cafe/docs/integrations/sign-in-with-gitcafe.md),
[GitCafe OpenAPI](https://git.cafe/api/openapi/json),
[Better Auth plugins](https://better-auth.com/docs/concepts/plugins), and
[Better Auth hooks](https://better-auth.com/docs/concepts/hooks).

The suite reuses generated RSA signatures and adversarial protocol inputs, with
explicit generated userinfo/principal responses from documented OpenAPI shapes.
These are not provider fixtures or proof of live compatibility. Genuine
same-token person userinfo/principal captures remain missing; do not enable
Connect from these tests. The final claim must freshly recheck person binding,
bot-authenticated current membership/role, expected app activity/installation,
selected repositories, Tripwire permission and uniqueness. Worker credential
handoff and full adapter runtime remain separate blockers. No claim endpoint,
repository namespace, repository/action work or live authenticated probe is part
of this slice.

Local verification of the connect foundation on base `360ec498`:

- Focused sign-in + connect protocol suite: 83 passed, 669 assertions, real
  throwaway PostgreSQL with generated adversarial provider transport.
- Full `bun test`: 4,057 passed across 338 files, 21 snapshots, zero failures.
- Both repository typecheckers (`typecheck`, `typecheck:ts5`), Biome, package
  boundaries and changed-line anti-slop checks pass.
- Antislop comment gate PASS: new comments use TSDoc for security constraints.
  Visual hard/purpose/liveliness gates are inapplicable: no UI or asset changed.
