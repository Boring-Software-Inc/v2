# GitCafe installed repository list capture

- Source: dedicated Tripwire staging app `int_01m60999c0fqg841d48s29qwtv`, scratch-only installation `ins_01m60zef0bfzzbx050fw4rymhr`.
- Method: GET
- URL: `https://git.cafe/api/repos?owner=boring&sort=id&limit=50`
- UTC capture time: 2026-10-28T10:16:12.457Z
- HTTP status: 200
- Content type: application/json
- Original SHA-256: `078036d35c6ff085df20e19d06eb82fd9ec946fc70d9890c12e2205a71582f67`
- Retained original: `/tmp/gitcafe-discovery-20261028-private/repositories.json`; enclosing folder mode 0700, files 0600.
- Scrubbing: none. JSON formatting only; all fields and values preserved. Contains only authorized `boring/scratch` metadata.
- Purpose: prove installed-token list pages provide the stable repository ID and the connection metadata without per-repository requests. The selected installation was verified scratch-only before minting its ephemeral scoped token. No selection changes, other installation reads, or repository writes occurred.
- Limits: one actual page, `next: null`; multiple pages and All scope are exercised with synthetic transports, not claimed as live captures.
