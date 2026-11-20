# Web Scope
Rules for `apps/web/**`.
TanStack Start dashboard. The redesign demo lives here; it is the design, final.
Four surfaces: Home (rollups) · Workflows (React Flow editor — LAST) · Rules ·
Insights. Plus `/events`, `/runs/$runId`, `/moderation`.

HARD RULES:
- Server state is TanStack Query fed by server functions calling `@tripwire/db`
  services. NO internal REST. Never `useState` + `fetch` for server data.
- Absolute imports: `#/` inside web, `@tripwire/*` across packages. Never `../../..`.
- Primitives come from `@tripwire/ui`; custom app composition lives in
  `src/components/<feature>/`. Check `@tripwire/ui` before writing a primitive.
- `src/mocks/` (today's mock data) shrinks to empty as build steps land — it is
  scaffolding, not a parallel state system to grow.
- New surfaces match the demo via the `tripwire-design` skill.
- Every rendered UI edit uses `.agents/skills/before-and-after/SKILL.md` and is
  not handed off until its PR contains verified before/after evidence. Net-new
  surfaces use an after-only Preview; motion uses a recording or frame sequence.

See `.claude/rules/frontend.md`, `.claude/rules/naming.md`,
`.claude/skills/tripwire-design/`.
