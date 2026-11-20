# GitCafe issue detail capture

Captured through `.claude/commands/capture-fixture.md` with GitCafe's authenticated `issue_read` WebMCP tool after creating the staging acceptance issue in `boring/scratch`.

- Method: issue_read WebMCP call (`facet: detail`)
- URL: https://git.cafe/boring/scratch/issues/4
- Captured at (UTC): 2026-11-20T03:54:00Z
- Status: successful tool result
- Content type: application/json
- Original SHA-256: `0f7f194b679dbbbfb6498df589ec303fb2dc1403c89db7a512530c057b56994d`
- Original: `/home/grim/.local/share/tripwire-fixture-captures/gitcafe-issue-4-detail-2026-11-20.json` (`0600`, containing directory `0700`)
- Extraction: parse the exact JSON object returned in the WebMCP result.
- Scrubs: none. JSON whitespace reformatted. Public test attribution and scratch-only content retained; no credentials or private email addresses are present.

This authenticated user read confirms the issue detail shape and exact identity corresponding to the delivery. The worker still uses an installation-scoped client and independently validates that authority before hydration.
