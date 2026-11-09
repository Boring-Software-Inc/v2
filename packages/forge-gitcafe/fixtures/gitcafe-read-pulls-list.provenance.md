# gitcafe-read-pulls-list

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/repos/boring/scratch/pulls/?limit=100`
- Captured at (UTC): `2026-10-29T00:51:32.823Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `c7b277e40cd4e21fb3d141c85c99c31f223d401f59f1e9cca466564e20705606`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/pulls-current.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the original response JSON.
- Scrubs: none. JSON formatting changes whitespace only. Public test attribution is retained. No issued credentials, authorization headers or private keys were captured.

This response used the dedicated staging installation client after current lifecycle, app, owner and exact scratch repository checks. It establishes installed read shape, not full protection or branch enforcement.
