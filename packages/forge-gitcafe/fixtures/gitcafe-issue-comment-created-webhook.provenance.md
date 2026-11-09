# gitcafe-issue-comment-created-webhook

Captured through `.claude/commands/capture-fixture.md` during authorized Tripwire Staging QA in `boring/scratch`.

- Method: `GET`
- URL: `https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m62kwy9rfgeaet1d65pr93wx/payload?eventCreatedAt=2026-10-29T01%3A20%3A26.405Z`
- Captured at (UTC): `2026-10-29T01:23:23.263Z`
- HTTP status: `200`
- Content type: `application/json`
- Original bytes SHA-256: `16ead2ae2dc8acb2ae34a0b316867873ae2e590d542c09372ceef71fd1dc5967`
- Retained original: `/tmp/gitcafe-event-acceptance-20261028-private/issue-comment-created-delivery.raw.json` (`0600`; containing directory `0700`)
- Extraction: parse the response wrapper, then its exact `body` string as JSON.
- Scrubs: none. JSON formatting changes whitespace only. Public test attribution is retained. No issued credentials, authorization headers or private keys were captured.
- Extracted body bytes SHA-256: `6b55090612298af1a8009c065c81ec4ddfa935caddb93975f2aeb4352f2fab2e`

The publisher payload establishes the real event shape. Receipt/HMAC admission is separately checked against the staging receipt bytes; this fixture alone does not establish workflow execution, owned actions, or enforcement.
