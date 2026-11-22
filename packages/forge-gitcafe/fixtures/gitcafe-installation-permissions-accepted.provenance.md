# GitCafe installation.permissions_accepted delivery payload

- Procedure: `.claude/commands/capture-fixture.md`.
- Method: authenticated publisher delivery payload reveal.
- Source URL: `https://git.cafe/orgs/boring/settings/apps/publish/tripwire-staging#webhook-deliveries`.
- Provider event: `evt_01m80wkq2zf25r0atfhtvggmtb`.
- Captured: `2026-11-22T06:04:12.390Z`.
- Delivery status: `200`; payload content type: `application/json`.
- Original payload: `/tmp/gitcafe-permission-capture/permissions-accepted.raw.json`; file mode `0600`, directory `0700`.
- Original payload SHA-256: `4e8c14ee64aba893d6d046c16039dde539d420b40eb5782e3d14e2084ed7d606`.
- Scrubbing: none. JSON whitespace was reformatted; parsed values are unchanged. No credentials, signatures, private emails, or tokens occur.

Authorized publisher-session read for Tripwire Staging revision 5. The payload
records the installed organization accepting the revision that added repository
attachment writes. It establishes the signed provider payload shape and the
provider's delivered status, not Tripwire's downstream lifecycle settlement.
