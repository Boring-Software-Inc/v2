# gitcafe-action-review-created

Captured from the dedicated Tripwire Staging app, restricted to authorized staging QA in `boring/scratch`.

- Method: `POST`
- URL: `https://git.cafe/api/repos/boring/scratch/pulls/1/reviews`
- Captured at (UTC): `2026-10-28T23:29:23.278Z`
- HTTP status: `201`
- Content type: `application/json`
- Original bytes SHA-256: `2e7669bfe0778dcd881d85c1300393bc2ba4766e8f683c8db254fb5eba7aab7a`
- Retained original: `/tmp/gitcafe-actions-20261028-private/review-created.raw.json` (0600; containing directory 0700)
- Scrubs: none. Public staging-bot and repository-owner attribution retained; no tokens, headers, assertions or private emails were captured. JSON formatting may change whitespace only.

The comment create/edit and temporary request-changes review/dismissal exercise genuine installed-app writes. The comment deletion capture is a real 403; its read capability also says delete=false. The owned QA comment remains; the temporary blocking review was dismissed and independently read back. These captures establish observed API shape and authority for these operations, not full Tripwire protection or branch enforcement.
