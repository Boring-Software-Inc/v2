# GitCafe installation.created delivery payload

- Procedure: `.claude/commands/capture-fixture.md`, authorized provider delivery read supplied by the parent.
- Method: `GET`.
- URL: `https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m609r47pferaf681y6xc39p1/payload?eventCreatedAt=2026-10-28T03%3A44%3A34.032Z`.
- Captured: `2026-10-28T06:44:14.181Z`.
- HTTP status: `200`; content type: `application/json`.
- Original payload: `/tmp/gitcafe-connection-live-20261028/installation-created-fresh.raw.json`; mode `0600`, directory `0700`.
- Capture metadata: `/tmp/gitcafe-connection-live-20261028/delivery-metadata.json`.
- Original payload SHA-256: `ec6a0831ad07a5258dec6b2bc82a61b50979cdf85f1c70e08ffd19ef5607fded`.
- Original response SHA-256: `29ebcf311fc820cfe2a2bc99a3b40320ac84d5ed2d3c3c0fdd55297638dc2573`.
- Scrubbing: no JSON values changed. Only whitespace was reformatted. Public boring/scratch attribution and opaque provider IDs remain. No tokens, credentials, private email, keys, or signature headers occur in this payload.
- Purpose: establish the actual lifecycle envelope shape. This provider-held payload is not evidence of an HTTP POST received by Tripwire or a live HMAC verification. Local cryptographic tests sign its exact bytes with a test-only key.
- Independent validation: `.claude/commands/validate-fixture.md` compares the separately retained originals, metadata, privacy, and corpus test. No other lifecycle delivery capture is available in this slice.
