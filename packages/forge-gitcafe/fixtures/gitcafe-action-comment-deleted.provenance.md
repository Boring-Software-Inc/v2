# gitcafe-action-comment-deleted

Captured from the dedicated Tripwire Staging app, restricted to authorized staging QA in `boring/scratch`.

- Method: `DELETE`
- URL: `https://git.cafe/api/repos/boring/scratch/pulls/1/comments/prcomment_01m62ddpzeeh6s2wc6nxqmqe5h`
- Captured at (UTC): `2026-10-28T23:27:23.914Z`
- HTTP status: `403`
- Content type: `application/problem+json`
- Original bytes SHA-256: `62353c0e3fe62488b768176a5ddaf643fe50829baba1231926425352ae6c2353`
- Retained original: `/tmp/gitcafe-actions-20261028-private/comment-deleted.raw.json` (0600; containing directory 0700)
- Scrubs: none. Public staging-bot and repository-owner attribution retained; no tokens, headers, assertions or private emails were captured. JSON formatting may change whitespace only.

The comment create/edit and temporary request-changes review/dismissal exercise genuine installed-app writes. The comment deletion capture is a real 403; its read capability also says delete=false. The owned QA comment remains; the temporary blocking review was dismissed and independently read back. These captures establish observed API shape and authority for these operations, not full Tripwire protection or branch enforcement.
