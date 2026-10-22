# product ideas

a parking place for product ideas tripwire will not build yet. nothing here is
built. nothing here is scheduled. each entry says what was asked for, why it
waits, and what a future design must respect.

source: the gsimone ui review of 2026-10-21
(`apps/web/design/gsimone-feedback-2026-10-21/README.md`).

---

## 1. custom prompt for ai review

**the idea:** let a maintainer write their own prompt for the `ai-review` rule,
next to the model and max steps fields it has today
(`aiReviewConfigSchema` in `packages/contracts/src/review.ts`).

**why it waits:** the ML layer is on the cut list in `AGENTS.md`. a custom
prompt turns ai review into a configurable ML surface, so it waits until Grim
amends the spec.

**what a future design must answer:**

- a prompt is free text that steers a verdict. the bounded trace and the
  output schema still have to hold, whatever the prompt says.
- a rule config change is a new rule version (`ai-review@N`), never an edit in
  place, so stored runs stay replayable.

---

## 2. workflows as code

**the idea:** let agents and people write workflows as code, the way GitHub
Actions does: a small DSL, a published schema, a skill, or an SDK.

**why it waits:** SDK publishing is on the cut list in `AGENTS.md`. the json
workflow graph in `packages/contracts/src/workflow.ts` is already the
substrate, and `@tripwire/sdk` stays private.

**what a future design must answer:**

- code must compile to the same validated workflow graph. one source of truth,
  one validator in contracts.
- a schema export is the smallest step and may come before any DSL.

---

## 3. mock event to test a workflow

**the idea:** a "test this workflow" action in the editor that runs a sample
event through the graph and shows which nodes ran and what each one decided.

**why it waits:** it is a new feature with its own scope, not a fix. it needs a
dry-run path that does not exist yet.

**constraints from the review:**

- the sample events are scrubbed real fixtures, captured the way
  `/capture-fixture` files them under `packages/forge-github/fixtures`. no
  hand-written payloads.
- the worker owns the dry run. `apps/web` must never import `@tripwire/core`
  (see the dependency arrows in `AGENTS.md`); the web app asks the worker and
  shows the result.
- no forge side effects. a dry run never blocks, labels, comments, or requests
  review on the forge. the replay job (`apps/worker/src/jobs/replay.ts`) is the
  nearest precedent: it re-executes runs and never calls github.
- the result shows the nodes that ran and their outcomes on the editor canvas.
- candidate entry point: the editor header
  (`apps/web/src/components/workflows/editor/editor-header.tsx`).
