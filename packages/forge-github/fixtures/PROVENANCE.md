# Fixture provenance

Captured payloads only — never hand-written (spec §11).

| File | Source | Captured | Notes |
|---|---|---|---|
| pull_request.opened.json | @octokit/webhooks-examples@7.6.1 (octokit-maintained captures of real GitHub deliveries) | 2026-07-11 | wrapper: `{ action?, ...payload }` under `payload`? — stored as the example object with `payload` field |
| pull_request.synchronize.json | same | 2026-07-11 | new-push-to-PR |
| pull_request.closed.json | same | 2026-07-11 | |
| issue_comment.created.json | same | 2026-07-11 | |
| push.json | same | 2026-07-11 | |
| ping.json | same | 2026-07-11 | non-ingested kind — normalize returns null |

TODO (VERIFICATION-QUEUE): once the App is live, replace/augment with
self-captured deliveries from the events table via /capture-fixture — octokit
examples are real captures but not from OUR App's permission set.
| installation.created.json | SELF-CAPTURED from our App's live events table, delivery 58273eb0-7d62-11f1-9480-7cc9b03d66cb | 2026-07-11 | no scrubbing needed (installation payloads carry URLs, not tokens) |
| installation.deleted.json | @octokit/webhooks-examples@7.6.1 | 2026-07-11 | replace with self-capture on next uninstall |
| installation_repositories.added.json | @octokit/webhooks-examples@7.6.1 | 2026-07-11 | |
| installation_repositories.removed.json | @octokit/webhooks-examples@7.6.1 | 2026-07-11 | |
