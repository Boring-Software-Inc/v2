# Authentication family migration report

## Scope

Migrated the login shell, brand lockup, FAQ content, embedded-browser notice, loading skeleton, and access-pending composition onto app-owned semantic roles backed by the Glaze contract.

Authentication providers, redirects, session behavior, development scenarios, waitlist status checks, and sign-out behavior remain unchanged.

## Contract changes

- Replaced login-page utility geometry with `login-shell`, `login-content`, `login-header`, and `login-card` roles.
- Replaced loading grid and disclosure geometry with semantic skeleton roles.
- Gave the shared brand lockup a closed semantic layout contract.
- Moved FAQ answer typography and embedded-browser notice spacing into the layout contract.
- Replaced access-pending layout, message, account identity, and truncation utilities with semantic roles.
- Retained the Dither implementation while assigning its login placement a named app-owned class because the shader accepts a class contract.

## Browser verification

Verified on `localhost:3001`:

- Login at 1280px and 390px.
- Expanded forge FAQ and nested answer at 390px.
- Keyboard-accessible disclosure controls and forge buttons.
- No document-level horizontal overflow at 390px.
- Login hierarchy, provider availability, development disclosure, and narrow card geometry remain intact.

The authentication component directory now reports zero design-system and anti-slop diagnostics. Access-pending behavior remains covered by its existing route and mutation contracts; this pass changed only its composition and did not fabricate a waitlist account in browser data.

## Evidence

- `login-1280.png` and `login-1280.aria.yml`
- `login-390.png` and `login-390.aria.yml`
- `login-faq-390.png` and `login-faq-390.aria.yml`
