# GitCafe installed issue list

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/repos/boring/scratch/issues/?limit=100`
- Captured at (UTC): `2026-10-29T03:30:56.016Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `5f65bb1172e9e89b367bb6357388da0cb755efac1f1d8738cc135c9438462fe5`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/issues-populated-current.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the original response JSON.
- Scrubs: none. JSON formatting changes whitespace only. Public QA attribution is retained; no authorization headers, tokens, assertions or private keys were captured.

This read used the dedicated staging installation client after current lifecycle, app, owner and exact scratch repository checks. It establishes an installed nonempty issue-page shape; it does not establish scheduled workflow execution or protection enforcement.
