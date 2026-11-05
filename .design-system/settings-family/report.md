# Settings shell migration report

## Scope

Migrated the organization settings frame, responsive settings navigation, settings cards, and loading skeleton composition onto app-owned semantic layout roles backed by the Glaze contract.

The individual settings pages retain their existing permission checks, queries, mutations, dialogs, and field behavior. The shell continues to compose members, roles, general settings, redaction, connections, agents, billing, and account sections without changing route capabilities.

## Contract changes

- Replaced the open `ITEM_CLASS` navigation string with closed `settings-nav`, `settings-nav-group`, and `settings-nav-item` roles.
- Moved desktop grid geometry, sticky navigation, narrow horizontal navigation, selected/hover states, and shell spacing into `layout-contract.css`.
- Replaced page-local settings frame and card geometry with `settings-frame`, `settings-grid`, `settings-page`, and `settings-card` roles.
- Migrated navigation and content skeleton geometry to semantic roles.
- Preserved the contextual history control in settings headers: it appears only after an internal navigation and remains absent on direct scenario entries.

## Browser verification

Verified on `localhost:3001` with disposable dev scenarios:

- Organization administrator at 1280px and 390px.
- Organization member at 390px.
- Horizontal settings navigation remains keyboard-accessible and scrollable on narrow screens.
- Desktop navigation remains sticky in its dedicated column.
- The current section remains visibly and semantically selected with `aria-current="page"`.
- Admin and member routes retain their loaded fields and permission-derived controls.
- No document-level horizontal overflow at 390px.

The settings component directory now reports zero design-system and anti-slop diagnostics.

## Evidence

- `admin-1280.png` and `admin-1280.aria.yml`
- `admin-390.png` and `admin-390.aria.yml`
- `member-390.png` and `member-390.aria.yml`
