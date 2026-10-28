# GitCafe foundation: isolation before protocol activation

This implementation starts from `origin/main` `696dd2ca30e736c01b45fb7f3ca92d60ad75b5cc` (release 123). It implements the first isolation slice authorized on 2026-10-27. GitCafe remains planned: no sign-in, connection, webhook receiver, runtime adapter, reads, actions, or credentials are enabled.

## Identity and existing behavior

`gitcafe` names `https://git.cafe`. `opengit` retains `https://open-git.com`, its historical rows, issuer, credentials, and paused runtime behavior. There is no identity migration between them. `ForgeId`/`forgeIdSchema` identify catalog entries; `Forge`/`forgeSchema` continue to admit only implemented ingest adapters. A repository identity is `{ forge, fullName }`; an identity is never authorization.

Repo-scoped history, latest/previous verdicts, block-review receipts, close-on-head fences, backfill selection, activity, moderation decisions, aggregates, previews, setup facts, deletion review counts, and cost attribution now qualify the repository by forge. Runs obtain their forge from their event foreign key. Retry routing and closed-review surfaces carry that forge through to adapter selection. Normalization cannot change a stored event's forge. Re-runs carry forge in their queue payload and cooldown key; old queued jobs can recover it from their claimed run's event. A legacy job without either source is refused.

One Tripwire org may contain repos from both forges. An unqualified duplicate repo name returns no match; no installation recency heuristic chooses a write target. MCP forge URLs retain the host and owner, and org grants/permissions still apply. Unknown hosts and contradictory org references are rejected. Existing pasted Tripwire dashboard URLs remain supported. Dashboard routes addressed only by org/repo name fail closed on ambiguity; opening both same-name repos there needs explicit forge routing before GitCafe activation. CLI project links already store the repo argument verbatim; regression coverage now verifies qualified hosts survive serialization and reload. Browser activity caches compare forge and name, and SSE visibility uses membership-visible repo IDs.

The non-GitHub installation-claim fallback that equated an OAuth person ID with an installation ID is removed. New non-GitHub claims remain denied pending real administrator proof. Existing claimed installations remain linked. GitHub installer/requester proofs, fresh administrator checks, expiry, wrong-user, and state-only rejection tests remain in place. Installation previews now require an explicit forge.

## PR review corrections

Analytics activity now uses the authorized repository's forge for blocked, passed, and review results. The MCP resolver compares accessible org-slug and forge-owner interpretations and rejects competing targets; explicit dashboard and forge URLs preserve their respective scopes. GitHub owner matching is case-insensitive, while OpenGit matching remains case-sensitive and case-colliding candidates fail closed. Re-run queue payloads are validated at enqueue and consumption; older jobs without a forge require a claimed run whose event provides an active forge.

The analytics regression uses controlled private GitHub and OpenGit database records with the same full name. The PR-head before and fixed after handler outputs were captured separately with freshly generated IDs; they are test evidence, not deployed GitCafe data. A separate capture ran the main-branch handler and its name-only service alongside the fixed handler against the same controlled database; main returned both forge records and the fix returned only the authorized forge.

## Migration and rollout

Migration `0045_forge_delivery_isolation` replaces the global delivery uniqueness index with `(forge, delivery_id)`. It changes no identity values or raw payloads. Same-forge redelivery remains atomic and enqueues once; different forges may reuse a delivery ID. GitCafe's eventual installation-plus-body-event-ID deduplication is a separate protocol requirement, not implemented by this index.

Deploy the new ingest code before removing the old index: its targetless `ON CONFLICT DO NOTHING` works with either constraint. The previous release's `ON CONFLICT (delivery_id)` requires the old unique index and cannot run against the migrated schema. A rollback to that release needs a schema compatibility plan; after cross-forge duplicate IDs exist, blindly restoring global uniqueness will fail. No deployment or production migration was performed here.

The index replacement is transactional under the existing migrator and takes a table/index lock. Historical aggregate rows are not rewritten by this migration; their normal recomputation now uses forge-qualified sources. Review the migration and deployment order before release.

## Evidence and limits

The regression suite uses the repository's real throwaway PostgreSQL setup. Database isolation tests include GitHub and reserved GitCafe rows with identical full names, external IDs, delivery IDs, PR numbers, and head SHAs in different orgs. These are authored database states, not captured GitCafe webhook fixtures. Planned GitCafe rows remain excluded from live repository routing and action retries. Active adapter routing tests use historical OpenGit alongside GitHub without treating it as GitCafe.

Assertions cover separate history/verdict/review receipts, no cross-forge moderation decision or closure, separate switcher/rollup/home/deletion counts, no foreign MCP run read or rule write, one org containing both namespaces, private-run visibility, SSE visibility, browser cache filtering, retry adapter selection, claimed re-run scope, atomic deduplication/enqueue, and disabled GitCafe catalog/webhook boundaries. These tests certify namespace isolation, not authenticated GitCafe compatibility.

Source research: `git-cafe-parity.md`, local research commit `8c438a82a49a30c5c79e527c39d0f24bfb45a82c`, with official captures under `/tmp/gitcafe-parity` during this session. `spec.md` and `docs/spec.md` are absent from this baseline; the historical specification is available as `653d82bb:docs/spec.md`. Current root/scoped rules and the user's explicit GitCafe authorization govern this slice.

## Validation

Review corrections: `bun test` passed 3,921 tests across 332 files (21 snapshots). The MCP integration suites passed 51 tests after the final parser cleanup, and the queue validation test passed after its missing-forge/no-run assertion was added. Biome, both TypeScript checks, boundary checks, the web production build, and worker/MCP bundles passed. The parent repeated the full suite successfully, moved raw job decoding to the queue consumer, and verified changed-line anti-slop against the pinned PR base. All 78 changed TypeScript files pass that gate. The re-run type is exported from the database barrel; the queue module does not re-export it.

- `bun test`: 3,917 passed, zero failures, 21 snapshots across 330 files; includes real PostgreSQL integration tests and the existing committed replay corpus.
- `bun run check`, primary `bun run typecheck` (tsrs), `bun run typecheck:ts5`, `bun run check:boundaries`, and changed-line anti-slop passed.
- `bunx drizzle-kit check` passed; migration snapshot comparison found no unrelated schema drift. The PostgreSQL integration suites applied migration 0045 and verified per-forge uniqueness plus atomic queue insertion.
- Production web build passed. Bun bundling of API, worker, and MCP entrypoints passed. No development server was started.
- Core evaluation semantics and rule versions were not changed; no live-history replay or authenticated GitCafe test was performed.

## Corrections to the initial parity report

The user forwarded a statement attributed to GitCafe's founder on 2026-10-27: teams and organizations are actors, and GitHub changes should trigger GitCafe webhooks. This is stakeholder evidence supplied through the parent task, not an authenticated test performed by this implementation.

The parent also inspected the supplied OpenAPI schema: `ActorId` is a string, and `Team` and `Organization` require `actorId`. The reviewer mutation accepts `actorIds`; the candidate description mentioning people/bots and the absence of a separate `teamIds` property do not establish that team/org actors are rejected. Native team/org review requests remain **unverified**, pending an authorized request, readback, and notification/permission tests. Do not substitute member expansion or restrict actor IDs to numbers or people.

The captured [webhook guide](https://git.cafe/docs/integrations/webhooks.md) says imported GitHub issues/PRs do not emit `issue.*`/`pull.*` events and historical activity is not delivered on webhook creation. That conflicts with the founder's statement about GitHub changes. **Initial historical import and ongoing GitHub synchronization need separate live tests.** Neither ongoing synchronized delivery nor its absence is certified here. This PR adds no capability exclusion for either reviewer actor kind or synchronized events.

## Next implementation slice

1. Extend the existing sanctioned capture procedure explicitly to GitCafe captures in the existing `packages/forge-opengit` home, with provenance and an independent corpus/protocol validator. Introduce GitCafe-specific exports/subpaths without changing legacy OpenGit exports. Admit real public response captures first; signed app/lifecycle/write captures require scoped staging credentials.
2. Implement and test ES256/P-256 app assertions with `kid`, app-ID `iss`/`sub`, exact endpoint `aud`, single-use UUIDv7 `jti`, and at most five minutes' lifetime. Installation lookup uses a Bearer assertion; mint uses a body assertion. Validate the 15-minute token's `expiresAt`, coalesced caching, revocation, repository selection, and authoritative administrator binding. Keep registration/configuration separate from implementation authorization.
3. Preserve raw webhook bytes, timestamp and key-version headers, verify HMAC over timestamp + `.` + body, enforce freshness, and deduplicate by installation/body event ID. Use `/api` paths and `pull.*` event names. Quarantine unknown/malformed payloads. Capture ongoing GitHub sync independently from initial imports, and test reviewer actor kinds without assuming rejection.
4. Add complete/paginated/OID-pinned source reads and versioned actions only with captured evidence. Missing/truncated sources become unavailable independently. Account age and global reputation stay unavailable for GitCafe: retain the same visible controls, disabled with explanatory reasons when the connector is surfaced. Do not synthesize dates, zeroes, or local substitutes. Submitted-review body editing remains deferred pending a supported contract.
5. Implement public-client OIDC separately with real registration and issuer/signature/audience/state/nonce/PKCE/verified-email/account-binding tests. [GitCafe's sign-in guide](https://git.cafe/docs/integrations/sign-in-with-gitcafe.md) documents issuer `https://git.cafe`; old OpenGit OAuth configuration is not a substitute. Login can be enabled after its own acceptance tests pass without claiming every forge feature works. Public app listing/pilot approval remains a rollout prerequisite.

No header/nav implementation, new package, dependency, route, rule, source fixture, user authentication configuration, registration, publication, merge, or deployment belongs to this slice.
