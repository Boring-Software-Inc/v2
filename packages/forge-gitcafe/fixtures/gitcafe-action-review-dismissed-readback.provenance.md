# gitcafe-action-review-dismissed-readback

Captured from the dedicated Tripwire Staging app, restricted to authorized staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/repos/boring/scratch/pulls/1/reviews/review_01m62dhk5yfkn9mge0r4b28e4m`
- Captured at (UTC): `2026-10-28T23:29:30.089Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `a722622e7219b255db6559450e91389b95a4eb2dfccec1b3781aeaa8ce037fa0`
- Retained original: `/tmp/gitcafe-actions-20261028-private/review-dismissed-readback.raw.json` (0600; containing directory 0700)
- Scrubs: none. Public staging-bot and repository-owner attribution retained; no tokens, headers, assertions or private emails were captured. JSON formatting may change whitespace only.

The comment create/edit and temporary request-changes review/dismissal exercise genuine installed-app writes. The comment deletion capture is a real 403; its read capability also says delete=false. The owned QA comment remains; the temporary blocking review was dismissed and independently read back. These captures establish observed API shape and authority for these operations, not full Tripwire protection or branch enforcement.
