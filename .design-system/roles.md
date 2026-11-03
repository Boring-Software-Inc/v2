# Route redesign roles

## Branches and worktrees

- Foundation branch: `semantic-ui-contract`
- Route redesign branch: `product-route-redesign`
- Frontend cleanup branch: `antislop-cleanup`
- Both child branches start from the same committed Glaze semantic-system baseline.
- The cleanup branch merges into the redesign branch only after its own verification.
- The redesign branch merges back into `semantic-ui-contract` only after the integration matrix passes.

## Ownership

- Coordinator and integrator: lead Pi session.
- Product-direction owner: user. The moderation pilot resolved to the Focus direction; later route work applies that accepted direction without reopening the picker.
- Route writer: lead Pi session in the product-route-redesign worktree.
- Cleanup writer: delegated subagent in the antislop-cleanup worktree.
- Verifier: a separate delegated read-only agent where available; otherwise the lead records self-verification explicitly.
- Final reviewer: a fresh read-only agent applying the real merge base and risk-proportional `understand-pr` review.

## Write boundaries

The route writer owns route-family components, application layouts, product-specific design-system contracts, and proven reusable `@tripwire/ui` additions. The cleanup writer owns only the strict non-route frontend finding set recorded in the route inventory. Shared enforcement files are lead-owned during integration.

No lane may modify unrelated `.agents/skills/**`, `.claude/**`, backend/domain behavior, production data, or another lane’s worktree. Subagents do not merge, commit to another lane, push, or write board state.

## Verification rule

A writer does not grade its own work as independently verified. Every verdict names the commands, browser states, evidence paths, and anything that could not be exercised.
