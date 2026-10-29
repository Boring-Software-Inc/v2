# gitcafe-read-issue-comments

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/repos/boring/scratch/issues/2/comments/?limit=100`
- Captured at (UTC): `2026-10-29T01:24:34.280Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `5af0f33dbbeb044fa5225a6ad01c910e4e572c5fef289e43950263f9d259121d`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/issue-comments-current.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the original response JSON.
- Scrubs: none. JSON formatting changes whitespace only. Public test attribution is retained. No issued credentials, authorization headers or private keys were captured.

This response used the dedicated staging installation client after current lifecycle, app, owner and exact scratch repository checks. It establishes installed read shape, not full protection or branch enforcement.
