# gitcafe-action-comment-created

Captured from the dedicated Tripwire Staging app, restricted to authorized staging QA in `boring/scratch`.

- Method: `POST`
- URL: `https://git.cafe/api/repos/boring/scratch/pulls/1/comments/`
- Captured at (UTC): `2026-10-28T23:27:16.150Z`
- HTTP status: `201`
- Content type: `application/json`
- Original bytes SHA-256: `9e215fbfdee1a972983d913f8b4300b09765861765204563e23461a9122ce058`
- Retained original: `/tmp/gitcafe-actions-20261028-private/comment-created.raw.json` (0600; containing directory 0700)
- Scrubs: none. Public staging-bot and repository-owner attribution retained; no tokens, headers, assertions or private emails were captured. JSON formatting may change whitespace only.

The comment create/edit and temporary request-changes review/dismissal exercise genuine installed-app writes. The comment deletion capture is a real 403; its read capability also says delete=false. The owned QA comment remains; the temporary blocking review was dismissed and independently read back. These captures establish observed API shape and authority for these operations, not full Tripwire protection or branch enforcement.
