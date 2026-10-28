---
description: Take a raw payload (events table, quarantined parse failure, or pasted), scrub PII/tokens, file it under the appropriate forge fixture home with provenance, and wire it into the contract-test corpus.
argument-hint: <source>
---

Capture a fixture from `$ARGUMENTS`. This is the ONLY sanctioned way to add a
fixture — fixtures are captured real payloads, NEVER hand-written from docs
(`.claude/rules/testing.md`).

`<source>` is one of: a `delivery_id` / event id in the `events` table, a
quarantined parse-failure reference, or a pasted raw payload / API response.

Steps:
1. Load the raw payload from the given source. If pasted, take it verbatim.
2. **Scrub** PII and secrets: tokens, installation credentials, private emails,
   auth headers — but preserve the shape and every field the parser reads. Note
   what was scrubbed.
3. File GitHub captures under `packages/forge-github/fixtures/`; use the
   GitCafe branch below for GitCafe. Choose a clear name and a provenance sidecar: where it came from, when, what was
   scrubbed, and why it was captured (e.g. "parse failure on 2026-07-…").
4. Wire it into the **contract-test corpus** so it parses against
   `@tripwire/contracts` on every PR; where a normalizer exists, test it too. If it was a parse failure, the new test
   should fail first, then pass once the schema/normalizer is fixed.
5. Run `bun test` for the contract layer and report. Never mutate an existing
   raw payload — append-only.

### GitCafe public API responses

For GitCafe, use `packages/forge-gitcafe/fixtures/`. Capture only an authorized
response; for public reads record the exact GET
URL, UTC capture time, HTTP status, response content type, and SHA-256 of the
original bytes. Save the original bytes outside the repository for validation.
Scrub secrets and private personal data without changing fields consumed by a
schema, record each edit in the sidecar, and retain public attribution only
when appropriate. Never commit credentials, signed delivery secrets, or tokens.
Add the captured response and sidecar; add a boundary schema and corpus test for
fields actually consumed. A public response is not evidence of authenticated
behavior or a webhook delivery.

After capture, run `/validate-fixture` independently of these steps. It must
compare the fixture to the saved original and inspect provenance and scrubbing;
a successful parser test alone is not validation. Stop if the original is no
longer available or a difference cannot be explained.
