# gitcafe-read-issues-list-empty

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/repos/boring/scratch/issues/?limit=100`
- Captured at (UTC): `2026-10-29T00:51:33.877Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `9e0ff922f3a1fdb6f20c0019bb4f2dbb93a0695cb2e25d4e26c93910365afd62`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/issues-current.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the original response JSON.
- Scrubs: none. JSON formatting changes whitespace only. Public test attribution is retained. No issued credentials, authorization headers or private keys were captured.

This response used the dedicated staging installation client after current lifecycle, app, owner and exact scratch repository checks. It establishes installed read shape, not full protection or branch enforcement.
