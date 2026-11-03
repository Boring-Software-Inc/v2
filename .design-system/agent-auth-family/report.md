# Agent authorization family migration report

## Scope

Migrated the shared agent authorization shell and the device/consent request compositions onto app-owned semantic layout roles backed by the Glaze contract.

The authorization protocol, Better Auth endpoints, scopes, organization grants, expiry behavior, account switching, and OAuth/device payloads remain unchanged.

## Contract changes

- Replaced request-shell utility geometry with `agent-request-shell`, `agent-request-content`, and `agent-request-header` roles.
- Replaced request-card utility composition with semantic roles for permissions, organization choices, actions, session duration, client identity, and code entry.
- Migrated the shared loading skeleton to semantic request roles.
- Kept the Dither background as the existing Glaze visual implementation while giving its placement a named app-owned class because the shader accepts a class contract.
- Allowed client details to wrap at narrow widths so the signed-in organization and 30-day duration remain readable.

## Browser verification

Verified on `localhost:3001` with disposable state and a real Better Auth device grant:

- Empty device-code entry at 390px.
- Ready device request with scopes and two organization choices.
- Organization selection enables approval.
- Real approval mutation reaches the signed-in success state.
- Expired device code.
- Expired consent link.
- No document-level horizontal overflow at 390px.
- The signed-in organization/duration detail wraps instead of truncating.

The five migrated request/device/consent files now report zero design-system and anti-slop diagnostics.

## Evidence

- `device-entry-390.png` and `device-entry-390.aria.yml`
- `device-request-390.png` and `device-request-390.aria.yml`
- `device-success-390.png` and `device-success-390.aria.yml`
- `device-expired-390.png` and `device-expired-390.aria.yml`
- `consent-expired-390.png` and `consent-expired-390.aria.yml`
