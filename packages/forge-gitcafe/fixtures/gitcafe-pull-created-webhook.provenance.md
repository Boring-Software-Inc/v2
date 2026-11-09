# GitCafe pull-created delivery capture

Captured through `.claude/commands/capture-fixture.md` from the dedicated Tripwire Staging app's delivery inspection endpoint. The delivery belongs to the authorized `boring/scratch` installation.

- Method: GET
- URL: https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m612t74gevdsc1w7mqakv2a4/payload?eventCreatedAt=2026-10-28T11%3A02%3A36.912Z
- Captured at (UTC): 2026-10-28T21:48:10.613Z
- Status: 200
- Content type: application/json
- Original SHA-256: 2a40a6750ce11d926a9f42d3e7711bc59448deaa8a5d66600acbea88fc905437
- Original: /tmp/gitcafe-protection-captures-20261028/pull-created.raw.json (`0600`, containing directory `0700`)
- Extraction: parse the response wrapper, then parse its exact `body` string as JSON.
- Scrubs: none. JSON whitespace reformatted. Public test attribution and scratch-only content retained; no credentials or private email addresses are present.

This capture proves the payload GitCafe attempted to deliver. It does not prove successful Tripwire ingress, HMAC verification, rule evaluation, or enforcement. The event predates activation of the receiver. Git push counters describe ref updates, not a complete commit count.
