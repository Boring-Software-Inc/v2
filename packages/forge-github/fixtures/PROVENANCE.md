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
| pull_request.edited.base.json | SELF-CAPTURED from our App's production events table, event 01a17035-cb45-7000-9cc2-910d7a9073d7, delivery 47f21c30-d001-11f1-87db-331ed1791910 (public repo trycompai/crm) | 2026-10-25 | no scrubbing needed: public repo, no tokens or private emails. Captured because a retarget (changes.base) never re-ran Tripwire. Sender is github-actions[bot], the author is hovanessb, so it also pins the contributor to the PR author |
| pull_request.edited.title.json | SELF-CAPTURED from production, event 01a17134-941a-7000-be56-e146a2a88bbf, delivery 285870f0-d028-11f1-95de-21c6e0f1f31f (public repo collection-of-things/aggregate-mail) | 2026-10-25 | no scrubbing needed. A contributor's own title edit, which rules read |
| pull_request.edited.body-by-bot.json | SELF-CAPTURED from production, event 01a171dd-9b5b-7000-8d7b-c88731fefdf1, delivery f3559580-d041-11f1-9736-f62ebf867855 (public repo collection-of-things/aggregate-mail) | 2026-10-25 | no scrubbing needed. A bot (blacksmith-sh[bot]) rewriting the description, the most common edit in production; it must not re-run Tripwire |
