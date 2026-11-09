# GitCafe git-push delivery capture

Captured through `.claude/commands/capture-fixture.md` from the dedicated Tripwire Staging app's delivery inspection endpoint. The delivery belongs to the authorized `boring/scratch` installation.

- Method: GET
- URL: https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m612sxqkebe8jyvftw58hr82/payload?eventCreatedAt=2026-10-28T11%3A02%3A27.294Z
- Captured at (UTC): 2026-10-28T21:48:10.860Z
- Status: 200
- Content type: application/json
- Original SHA-256: 1f1064f27d6ad6600177491a61324fad36f3f18f8a432a980a0220c4f99ec371
- Original: /tmp/gitcafe-protection-captures-20261028/git-push.raw.json (`0600`, containing directory `0700`)
- Extraction: parse the response wrapper, then parse its exact `body` string as JSON.
- Scrubs: none. JSON whitespace reformatted. Public test attribution and scratch-only content retained; no credentials or private email addresses are present.

This capture proves the payload GitCafe attempted to deliver. It does not prove successful Tripwire ingress, HMAC verification, rule evaluation, or enforcement. The event predates activation of the receiver. Git push counters describe ref updates, not a complete commit count.
