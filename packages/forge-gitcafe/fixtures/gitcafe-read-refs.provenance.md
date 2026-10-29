# gitcafe-read-refs

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/repos/boring/scratch/refs?limit=100`
- Captured at (UTC): `2026-10-29T00:51:34.936Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `f9640790f74b153e9c02190cd6a5a5899ca54c32989e2795f537a029b7a97d45`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/refs-current.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the original response JSON.
- Scrubs: `items[0].targetCommit.author.email` replaced with `[REDACTED]`; `items[1].targetCommit.author.email` replaced with `[REDACTED]`. JSON formatting changes whitespace only. Public test attribution is retained. No issued credentials, authorization headers or private keys were captured.

This response used the dedicated staging installation client after current lifecycle, app, owner and exact scratch repository checks. It establishes installed read shape, not full protection or branch enforcement.
