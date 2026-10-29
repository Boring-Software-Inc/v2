# gitcafe-action-review-dismissed

Captured from the dedicated Tripwire Staging app, restricted to authorized staging QA in `boring/scratch`.

- Method: `POST`
- URL: `https://git.cafe/api/repos/boring/scratch/pulls/1/reviews/review_01m62dhk5yfkn9mge0r4b28e4m/dismiss`
- Captured at (UTC): `2026-10-28T23:29:28.943Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `e61ac2e5ee9a4e8109296587b4fab7d09a872b0c8367fcfd19a26abce21e0303`
- Retained original: `/tmp/gitcafe-actions-20261028-private/review-dismissed.raw.json` (0600; containing directory 0700)
- Scrubs: none. Public staging-bot and repository-owner attribution retained; no tokens, headers, assertions or private emails were captured. JSON formatting may change whitespace only.

The comment create/edit and temporary request-changes review/dismissal exercise genuine installed-app writes. The comment deletion capture is a real 403; its read capability also says delete=false. The owned QA comment remains; the temporary blocking review was dismissed and independently read back. These captures establish observed API shape and authority for these operations, not full Tripwire protection or branch enforcement.
