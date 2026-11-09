# GitCafe native check re-run pending response

Captured through `.claude/commands/capture-fixture.md` during authorized, scratch-only staging QA.

- Method: `POST`
- URL: `https://git.cafe/api/repos/boring/scratch/check-runs/checkrun_01m6130wzse6cttdpq35c1rybe/rerequest`
- Captured at (UTC): `2026-10-29T03:15:26.374Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `98b07c990af9a355fd8c532e4c56c1e24916be09444b96b5e608e4b34ca188f9`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/check-rerequest-pending-150.raw.json` (`0600`; containing directory `0700`)
- Scrubs: none. JSON formatting changes whitespace only. No request credentials, authorization headers, cookies, assertions, or tokens were captured.

A person requested this re-run through GitCafe's authenticated API. The target was the dedicated staging app's existing `tripwire-staging-qa` check in `boring/scratch`; its stable repository, installation and reporter identities were checked before the request. The operation identity was persisted separately before the write. This pins real queued status, cleared conclusion and the pending timestamp. It does not establish Tripwire evaluation or enforcement. The QA check was subsequently returned to neutral, renamed `tripwire/staging-protocol-qa`, and made non-rerunnable so it cannot satisfy a required `tripwire` check or advertise an unhandled QA action.
