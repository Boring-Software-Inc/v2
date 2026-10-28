---
description: Independently audit a captured GitCafe fixture against its original response and provenance.
argument-hint: <fixture> <original>
---

Audit `$ARGUMENTS` without using the capture procedure to produce the evidence.
1. Read the provenance sidecar. Verify the source is an authorized GitCafe GET,
   the timestamp, status, URL, original SHA-256, and every stated scrub.
2. Hash the separately retained original bytes. Compare parsed JSON recursively
   with the committed fixture; account for every difference using the sidecar.
   Inspect both for credentials and private personal data without printing them.
3. Run the fixture corpus test. Report the hash comparison, differences, privacy
   review, and test result. Fail if evidence is missing or any difference is
   unexplained. Never modify the fixture during this audit.
