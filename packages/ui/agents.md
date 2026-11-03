# UI Scope

Rules for `packages/ui/**`.

Package-level, application-agnostic design-system contracts only: semantic primitives, proven generic molecules, and their semantic CSS.

HARD RULES:
- No app logic, data fetching, route modules, auth, or domain types.
- No imports from apps or `@tripwire/contracts`.
- A consumer reaching for `className`, `style`, color, spacing, size, weight, or leading controls to change chrome is a smell. Expose a finite semantic prop only when real call sites prove it.
- Product-specific composition and geometry stay in `apps/web/src/components`.
- Glaze implementation components stay in the web app unless a separately approved migration moves them.
- Match the established application output. Do not invent a look.

See `.claude/rules/frontend.md` and `.claude/skills/tripwire-design/`.
