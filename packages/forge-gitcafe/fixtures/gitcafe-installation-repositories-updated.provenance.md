# GitCafe installation.repositories_updated delivery payload

- Procedure: `.claude/commands/capture-fixture.md`.
- Method: `GET`.
- URL: `https://git.cafe/api/orgs/boring/apps/tripwire-staging/deliveries/whdlv_01m60z9dqafk1t8cjpv4zgv1aa/payload?eventCreatedAt=2026-10-28T10%3A01%3A00.898Z`.
- Captured: `2026-10-28T11:22:47.940Z`.
- HTTP status: `200`; content type: `application/json`.
- Original payload: `/tmp/gitcafe-lifecycle-provider-captures/repositories-updated.raw.json`; file mode `0600`, directory `0700`.
- Original response: `/tmp/gitcafe-lifecycle-provider-captures/repositories-updated.response.json`; file mode `0600`.
- Original payload SHA-256: `f1ae41e1501681535fb89509d4d69cd6f17c5936ba93ebe134f5f3bd23a8d947`.
- Original response SHA-256: `a2e00531109ba4199747c47e62ae336b5fc3a28eb4195e0143345d37abe6f2ec`.
- Scrubbing: none. The API's `body` string was extracted verbatim and JSON whitespace reformatted; parsed values are unchanged. No credentials, signatures, or private emails occur.

Authorized publisher-session read for the dedicated Tripwire Staging app. The
payload concerns the user's old staging installation and its real lifecycle
change. It establishes payload shape and the recorded event, not successful
Tripwire ingress or live timestamped-HMAC verification. The envelope's version
is a payload version, not a webhook signing-key version.
