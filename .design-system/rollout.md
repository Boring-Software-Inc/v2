# Semantic UI contract rollout

## Ratchet baseline

After the enforcement-hardening snapshot below, the changed-line gate rejects new violations while the global baseline must match exactly and may only be updated downward.

| Rule | Legacy count after pilot |
| --- | ---: |
| Direct implementation imports | 0 |
| Arbitrary Tailwind values/selectors | 65 |
| JSX style escape hatches | 35 |
| Raw color choices | 504 |
| Raw spacing choices | 691 |
| Raw typography choices | 339 |

The members pilot reduced the existing color baseline by 4, spacing by 8, and typography by 7. The enforcement hardening pass then rebased the exact counts to include previously invisible classes in named class constants, nested class composers, and variant-prefixed utilities. New arbitrary-value and inline-style rules were planted with failing fixtures before their baselines were recorded.

## Package architecture

The proven, application-agnostic layer now lives in the existing `@tripwire/ui` workspace:

- semantic typography components and CSS;
- semantic color mappings;
- generic page, section, action-row, and form-section molecules with their layout CSS.

Web keeps its stable feature facades, so component-family migration does not require feature import churn. Glaze components and providers remain app-owned. The package CSS consumes Glaze-provided custom properties in web, while member and invite collection-row layout remains app-owned.

## Component-family migration

The settings page family uses the semantic contract through its shared composition rather than page-local rewrites:

- `SettingsHeader` delegates through the page compatibility facade to package-owned `PageHeader` and `PageTitle`.
- `SettingsSection` delegates through the section compatibility facade to package-owned `Section`, `SectionHeader`, `SectionBody`, and `SectionHeading`.
- `SettingsContentSkeleton` and `SettingsNavSkeleton` own settings loading geometry.
- Nine settings page families receive semantic page titles through the shared header.
- Five settings page families receive semantic sections through the shared section composition.
- Members and invite rows use the app-owned responsive collection-row molecule.
- Shared settings forms use package-owned `FormSection` and `FormActions`; `SettingsDangerRow` now owns its boundary and rhythm through the app layout contract, reducing the raw-color baseline by one more occurrence.

## Next family order

1. Collection rows and action groups outside members.
2. Page headers in rules, workflows, analytics, activity, and moderation.
3. Empty, error, and loading state compositions.
4. Dialog and form action rows.

Each family migration keeps feature imports on the stable facade and updates the exact lint baseline in the same change. Page-local migrations are rejected when an existing shared family owns the structure. Glaze implementation movement remains deferred until a later, separately reviewed change.
