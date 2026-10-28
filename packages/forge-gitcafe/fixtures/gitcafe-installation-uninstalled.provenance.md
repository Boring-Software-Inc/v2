# GitCafe installation.uninstalled delivery payload

- Procedure: `.claude/commands/capture-fixture.md`.
- Method: `GET`.
- URL: `https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m60zdw1cfk1t8ckq839kdhg9/payload?eventCreatedAt=2026-10-28T10%3A03%3A26.632Z`.
- Captured: `2026-10-28T11:21:43.337Z`.
- HTTP status: `200`; content type: `application/json`.
- Original payload: `/tmp/gitcafe-lifecycle-provider-captures/uninstalled.raw.json`; file mode `0600`, directory `0700`.
- Original response: `/tmp/gitcafe-lifecycle-provider-captures/uninstalled.response.json`; file mode `0600`.
- Original payload SHA-256: `5daf3a942ef1698dbaf9b26bb95ceb0ff8c788ce3360410784cb506f4791580b`.
- Original response SHA-256: `ee493e5a456f94c73b3e718a6881105ce5138c7bdd3259221f89b4d94545f661`.
- Scrubbing: none. The API's `body` string was extracted verbatim and JSON whitespace reformatted; parsed values are unchanged. No credentials, signatures, or private emails occur.

Authorized publisher-session read for the dedicated Tripwire Staging app. The
payload concerns the user's old staging installation and its real lifecycle
change. It establishes payload shape and the recorded event, not successful
Tripwire ingress or live timestamped-HMAC verification. The envelope's version
is a payload version, not a webhook signing-key version.
