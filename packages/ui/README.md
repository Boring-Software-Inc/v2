# @tripwire/ui

Tripwire's application-agnostic semantic UI contract.

## Exports

- `@tripwire/ui/typography`: fixed semantic typography roles.
- `@tripwire/ui/layouts`: generic page, section, action-row, and form-section molecules.
- `@tripwire/ui/styles/color.css`: semantic color-role mappings.
- `@tripwire/ui/styles/typography.css`: typography role styles.
- `@tripwire/ui/styles/layout.css`: generic molecule layout styles.

The React APIs do not accept arbitrary `className`, `style`, color, spacing, size, weight, or leading controls. Consumers choose content and finite semantics, not visual values.

The CSS entrypoints expect the consuming implementation to define the custom properties they use. Web currently loads Glaze first, then these semantic styles. Glaze owns the current type scale, spacing scale, controls, radii, surfaces, and state values. Glaze implementation components and product-specific web layouts are not package exports.
