# GitCafe issue-created delivery capture

Captured through `.claude/commands/capture-fixture.md` from the dedicated Tripwire Staging app's delivery inspector. The delivery belongs to the authorized `boring/scratch` installation.

- Method: GET
- URL: https://git.cafe/orgs/boring/settings/apps/publish/tripwire-staging#webhook-deliveries
- Captured at (UTC): 2026-11-20T03:52:00Z
- Delivery created at (UTC): 2026-11-20T03:51:39.192Z
- Status: 200
- Delivery result: HTTP 200, one attempt
- Content type: application/json
- Original SHA-256: `f9a52a92d51624f5284630dc86cc35f0c364645b48a8f9f7c3b6fbd41cde5131`
- Original: `/home/grim/.local/share/tripwire-fixture-captures/gitcafe-issue-created-2026-11-20.json` (`0600`, containing directory `0700`)
- Extraction: copy the expanded delivered payload shown by GitCafe's authenticated app publisher UI.
- Scrubs: none. JSON whitespace reformatted. Public test attribution and scratch-only content retained; no credentials or private email addresses are present.

GitCafe reported that staging accepted the signed delivery with HTTP 200. This capture establishes the provider payload shape and successful receiver response, not downstream rule evaluation or enforcement.
