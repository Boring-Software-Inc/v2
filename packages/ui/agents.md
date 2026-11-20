# UI Scope

Rules for `packages/ui/**`.

Package-level, application-agnostic design-system contracts only: semantic primitives, proven generic molecules, and their semantic CSS.

HARD RULES:
- No app logic, data fetching, route modules, auth, or domain types.
- No imports from apps or `@tripwire/contracts`.
- Follow the five-layer UI architecture, variant boundary, preservation rule,
  spec gate, and independent audit contract in the root `AGENTS.md`.
- `@ui-sdk/*` is an implementation detail of this package. Applications import `@tripwire/ui` only.
- Before changing an interactive primitive, read the pinned ui-sdk React and Core `llms.txt` files from the installed package version.
- ui-sdk is the behavioral layer, not the visual design system. Preserve
  Tripwire anatomy, tokens, geometry, states, and motion when replacing a
  behavior primitive.
- A native `<button>` is not automatically the shared `Button`. Product roles
  with distinct anatomy or interaction contracts require a named molecule,
  not a location-specific Button variant.
- Every primitive or molecule change that can affect rendered output activates
  `.agents/skills/before-and-after/SKILL.md`; the consuming surface needs
  published and verified before/after evidence before PR handoff.
- A consumer reaching for `className`, `style`, color, spacing, size, weight, or leading controls to change chrome is a smell. Expose a finite semantic prop only when real call sites prove it.
- Public component props are hand-authored semantic contracts. Do not expose `className`, `style`, `render`, `asChild`, `slotProps`, `classes`, `unstyled`, or raw ui-sdk state through exported types.
- Product-specific composition and geometry stay in `apps/web/src/components`.
- Every interactive export requires an accessible-name contract, keyboard coverage, explicit agent actions, and change-source propagation.
- Mutating agent actions fail closed. Destructive actions share one confirmation contract for human and agent callers; consumers cannot disable it.
- Agent-hidden and sensitive content use explicit semantic props backed by tests, never arbitrary data attributes at call sites.
- Base UI and Glaze are migration sources only. Do not add new imports or compatibility facades.
- Match the established application output. Do not invent a look.

See `.claude/rules/frontend.md` and `.claude/skills/tripwire-design/`.
