---
description: The dependency arrows between packages/apps and how the boundary check enforces them. Load when adding imports, new files, or touching package boundaries.
paths:
  - "packages/**"
  - "apps/**"
  - "scripts/check-boundaries.ts"
---

# Architecture — the dependency arrows

The arrows ARE the architecture. `scripts/check-boundaries.ts` fails the build on
any wrong-direction import (`bun run check:boundaries`, and in CI).

```
contracts     ← everything            (imports nothing but zod)
utils         ← everything except contracts
forge         ← forge-github, forge-opengit, forge-gitcafe, worker
                                       (interface + types only; imports contracts)
core          ← worker ONLY           (pure: imports contracts + utils only.
                                       NO I/O, no db, no forge, no AI SDK, no octokit.
                                       Effects are INJECTED — see review-agent.md)
sdk           ← forge-github, worker, db, web
                                       (signal registry; pure, imports contracts only)
db            ← worker, api, web      (schema + services)
auth          ← web, api              (./server sessions + posture guard,
                                       ./client browser; imports db + utils)
forge-github  ← worker, api           (api uses webhook verify only)
forge-gitcafe ← worker, api           (GitCafe protocol; activation remains gated)
ui            ← web                   (primitives; no app logic, no data fetching)
```

Invariants:
- **apps import packages; packages NEVER import apps.**
- **Nothing imports `@tripwire/core` except `apps/worker`.**
- `@tripwire/contracts` imports nothing but `zod`.
- `@tripwire/forge` is interface + types only — no helpers, no base classes.
  Adapters are siblings and never import each other.
- Effects are injected into core, never imported by it. `core` staying pure is
  what makes rules unit-testable as pure functions over fixture contexts.

The layout (§3) is closed. If work doesn't fit an existing package, STOP and flag
it — do not invent a home. New top-level packages/apps/folders are forbidden
without a DECISIONS.md entry.

The owner approved `packages/forge-gitcafe` on 2026-10-27. GitCafe code and
fixtures belong there; historical OpenGit stays in `packages/forge-opengit`.
The packages are siblings and do not import each other. See DECISIONS.md.

How the check works: it reads every `import`/`export … from` in `packages/*` and
`apps/*` source, resolves `@tripwire/*` specifiers to their package, and asserts
the edge is in the allow-list above. A violation prints the offending file, the
illegal edge, and exits non-zero.
