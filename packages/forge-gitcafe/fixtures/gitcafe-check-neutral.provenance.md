# GitCafe staging check capture

- Method: `PUT`
- URL: `https://git.cafe/api/repos/boring/scratch/commits/2bff66c45a9e2241fc2482bc63bac23281a7377f/check-runs/tripwire-staging-qa`
- Captured at: `2026-10-28T11:06:16.023Z`
- HTTP status: `201`
- Content type: `application/json`
- Original SHA-256: `b0ad2473664653be958735aa9a4bdf69467dd7c617b7a1db64eba3f854419cf5`
- Retained original: `/tmp/gitcafe-scratch-qa-20261028/checks/check-neutral.raw.json` (owner-only file and directory).
- Scrubbing: none. JSON whitespace was reformatted; parsed values are unchanged.

Authorized scratch-only staging protocol test using the dedicated Tripwire Staging app
`int_01m60999c0fqg841d48s29qwtv`, selected installation
`ins_01m60zef0bfzzbx050fw4rymhr`, and immutable repository
`repo_01m608d2crfqzt2vc8akngqsc0` (`boring/scratch`). The exact open PR head and
repository identity were checked before the write. Issued credentials and request
headers were kept in memory and are absent from the capture.

The neutral QA check was read back and its installation, bot reporter, head and
key matched. This proves an authenticated check report/readback, not webhook
receipt, workflow execution, or branch-protection enforcement.
