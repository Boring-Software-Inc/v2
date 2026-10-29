# gitcafe-pull-comment-created-webhook

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m62h49h9e91rg7dr6tct5jjg/payload?eventCreatedAt=2026-10-29T00%3A32%3A01.540Z`
- Captured at (UTC): `2026-10-29T00:32:35.352Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `4b50e4ae58142dc003e73dd2c18cfd3503f54f518e5156bb5e720bf3e1af517c`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/pull-comment-created-delivery-200.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the response wrapper, then its exact `body` string as JSON.
- Scrubs: none. JSON formatting changes whitespace only. Public test attribution is retained. No issued credentials, authorization headers or private keys were captured.
- Extracted body bytes SHA-256: `a7faa5a8a893686d97cea93bda788166c67017fec5feb99f07e38bba0c0fcdf6`

The publisher payload establishes the real event shape. Receipt/HMAC admission is separately checked against the staging receipt bytes; this fixture alone does not establish workflow execution, owned actions, or enforcement.
