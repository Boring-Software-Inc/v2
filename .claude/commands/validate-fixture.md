---
description: Independently audit a captured GitCafe fixture against its original response and provenance.
argument-hint: <fixture> <original>
---

Audit `$ARGUMENTS` without using the capture procedure to produce the evidence.
1. Read the provenance sidecar. Verify the authorized source: a public GET,
   staging installation lookup, staging token exchange, or app delivery read.
   Check the method, timestamp, status, URL, original hash, and every scrub.
2. Hash the separately retained original bytes. Compare parsed JSON recursively
   with the committed fixture; account for every difference using the sidecar.
   Inspect both for credentials and private personal data without printing them.
   For a token exchange, require the fixture token to be `[REDACTED]`, the
   private original to contain an issued token, and all other fields to match.
   Verify retained originals have owner-only permissions. A provider delivery
   read is not proof of successful ingress or HMAC verification by Tripwire.
3. Run the fixture corpus test. Report the hash comparison, differences, privacy
   review, and test result. Fail if evidence is missing or any difference is
   unexplained. Never modify the fixture during this audit.
