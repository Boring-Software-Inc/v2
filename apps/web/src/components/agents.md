# Components Scope
Rules for `apps/web/src/components/**`.
Custom app-specific composition. Organized `components/<feature>/<part>` (home,
events, runs, rules, workflows/editor, moderation, layout, …).

HARD RULES:
- Primitives belong in `@tripwire/ui`, not here. Import them; don't re-derive.
- Follow the five-layer UI architecture, variant boundary, preservation rule,
  spec gate, and independent audit contract in the root `AGENTS.md`. Read the
  root `DESIGN.md` before changing a visual or interaction contract.
- Product molecules own contextual anatomy and geometry here when they bind app
  data, navigation, queries, auth, or domain behavior. Compose them from
  `@tripwire/ui`; do not force them into generic primitive variants.
- A primitive migration must preserve the approved rendered and interaction
  baseline unless the implementation spec explicitly marks the surface for
  redesign.
- Extract a component when it hits 50+ lines, is used in 2+ files, or owns state.
  Keep it inline when <10 lines, single-use, presentational.
- Keep `useEffect` down: server sync → a query; derived state → `useMemo`;
  stable callback deps → refs.
- Audited via /ui-review against `@tripwire/ui` + the tripwire-design skill.
- The `#/lib/*.types` files are deprecated demo-name aliases — scaffolding that
  dies with `src/mocks`; new code imports `@tripwire/contracts` names directly.

See `.claude/rules/frontend.md`, `.claude/rules/naming.md`.
