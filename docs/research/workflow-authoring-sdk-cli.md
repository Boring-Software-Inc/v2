# Workflow authoring SDK and CLI design

Status: the standalone SDK and CLI workflow directory are implemented locally. Pull, slug discovery, and the push review payload are covered by a round-trip test. The SDK GitHub repository exists. Package publication and authenticated preview remain separate steps.

This document records the workflow-authoring SDK decisions from the Context.dev SDK review and the CLI contract findings from the Vercel CLI design review. It is a design and implementation reference, not evidence that the SDK, workflow directory, preview command, or CLI repairs have shipped.

## Goal

Tripwire workflows should be typed policy code that compiles into the existing canonical `WorkflowDefinition` graph before preview or push. The SDK should make valid workflows easy to discover in an IDE. The CLI should load those local definitions, apply one predictable command contract, and use the same validated preview and push behavior available to programmatic consumers.

The broader platform-management SDK remains out of scope. This work does not add speculative provisioning, organization, billing, activity, or moderation APIs.

## Sources and observed baseline

- [Context.dev TypeScript SDK](https://github.com/context-dot-dev/context-typescript-sdk) for its task-first README, one-package install, environment-based credentials, `client.resource.verb` organization, inferred request and response types, typed errors, and documented retries and timeouts.
- [Vercel CLI design guidelines](https://vercel.com/design/cli) for command grammar, streams, machine output, consent, cancellation, terminal behavior, and help conventions.
- The current Tripwire authoring runtime in `packages/contracts/src/workflow-authoring.ts` and its generated catalog in `packages/contracts/src/workflow-authoring-catalog.ts`.
- The current CLI workflow loader and code generator in `apps/cli/src/workflows-code.ts`.
- The current CLI command tree in `apps/cli/src/manage.ts` and `apps/cli/src/program.ts`.
- The workflow identity and push-review decisions in `DECISIONS.md`.

The current repository already has a private `@tripwire/sdk`, but it owns the forge-bound signal and custom-rule API rather than workflow authoring. It keeps that internal role. The public TypeScript SDK lives in a standalone `tripwire-typescript-sdk` repository and uses the npm name `@tripwire-sh/sdk`. The workflow authoring implementation in contracts remains the current production path until the CLI migration is complete.

## Accepted authoring contract

### Files and identity

Pulled workflows live at:

```text
.tripwire/
  project.json
  workflows/
    contribution-review.ts
    scheduled-cleanup.ts
```

Each file default-exports exactly one workflow. The filename without `.ts` is the stable workflow slug. The display name is mutable and does not determine identity.

`.tripwire/project.json` remains the authority that maps a stable slug to its remote workflow ID. Repeated pushes update the same remote workflow. Renaming a display name does not create a second workflow. Renaming a file is an identity operation and must not be inferred silently.

A missing local file never authorizes remote deletion. Pull does not overwrite local edits silently. Push does not alter enabled state. New workflows remain off until a person explicitly enables them.

Pull renders the saved graph as a typed `defineWorkflow(...)` module. The filename supplies the local slug. The project link retains the remote ID and a hash of the last pulled file, so a later pull can refresh unedited files and refuse conflicts. Delivery secrets stay on the server.

### Package surface

The approved public package is `@tripwire-sh/sdk` in the standalone `tripwire-typescript-sdk` repository:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./workflows": "./dist/workflows/index.js"
  }
}
```

`@tripwire-sh/sdk/workflows` is the pure, network-free authoring and compilation surface. The initial package root re-exports that surface. It is reserved for a future authenticated resource client only after a real server contract exists. The private `@tripwire/sdk` package does not move or become public as part of this work.

The repository amendment and package name are approved. Publishing the npm package, creating the remote repository, deploying server capabilities, and mutating live workflows still require separate approval.

### Simple workflow

```ts
import {
  accountAge,
  block,
  changeRequest,
  workflow,
} from "@tripwire-sh/sdk/workflows";

export default workflow({
  when: changeRequest.opened,
  require: accountAge({ minDays: 30 }),
  otherwise: block(),
});
```

The file does not repeat its slug, display name, coordinates, or serialized graph. `workflow()` remains the graph constructor. A collection wrapper is unnecessary when one file owns one workflow.

### Complex workflow

```ts
import {
  accountAge,
  aiReview,
  all,
  block,
  changeRequest,
  humanReview,
  maxFilesChanged,
  workflow,
} from "@tripwire-sh/sdk/workflows";

const age = accountAge({ minDays: 30 });
const size = maxFilesChanged({ max: 100 });
const screening = all(age, size);
const review = aiReview().after(screening.passes);
const human = humanReview().after(review.fails);
const blockContribution = block().after(
  screening.fails,
  human.denied,
);

export default workflow({
  when: [changeRequest.opened, changeRequest.updated],
  require: screening,
  otherwise: blockContribution,
  steps: {
    age,
    size,
    screening,
    review,
    human,
    blockContribution,
  },
});
```

Named properties are stable step IDs, not generated SDK methods. `.after(...)` remains available for explicit graphs but should not appear when `when`, `run`, `require`, `then`, and `otherwise` already express the sequence.

### Scheduled workflow vocabulary

The ergonomic authoring surface should map onto the current canonical schedule contracts without renaming stored forge-neutral fields:

```ts
import {
  label,
  lockConversation,
  schedule,
  workflow,
} from "@tripwire-sh/sdk/workflows";

export default workflow({
  when: schedule({
    every: "12h",
    timezone: "America/Los_Angeles",
    find: {
      types: ["issue", "pull-request"],
      state: "open",
      inactiveFor: "15d",
      conversationLocked: false,
    },
  }),
  run: [
    label("stale"),
    lockConversation(),
  ],
});
```

Accepted vocabulary direction:

- `lockConversation` instead of unexplained `lock`.
- `find.types` instead of `match.subjects`.
- Readable `issue` and `pull-request` authoring terms.
- `conversationLocked: false` instead of `skipLocked: true`.
- Durations such as `"12h"` and `"15d"`.

The compiler translates those names into the existing canonical representation and preserves timezone, inactivity, matching, and lock behavior exactly.

## Type-safety contract

Everything exposed for workflow authoring must be typed and runtime-validated:

- Event names are a closed literal union.
- Rule IDs autocomplete from the selected catalog.
- Selecting a rule determines its required and optional settings.
- Extra settings, missing settings, and wrong value types fail compilation.
- Action names are closed and their params are inferred per action.
- Action parameter values use literal unions where the domain is closed.
- Schedule fields and durations are typed.
- `.passes`, `.fails`, `.approved`, and `.denied` retain their output-port types.
- `.after(...)` accepts only valid step or output references.
- Workflow step names become stable references.
- Trigger, rule, action, and subject compatibility is represented in types where practical and always enforced by the runtime compiler.
- Rule versions remain explicit in the compiled definition and validated against the compatible catalog.
- Generated or pulled code contains no `any`, unsafe casts, suppression comments, or untyped settings bags.

Namespaced event constants are the concise default because they expose documentation and autocomplete for each event:

```ts
workflow({
  when: [
    changeRequest.opened,
    changeRequest.updated,
  ],
});
```

They compile to the existing canonical strings. Raw string events are deliberately not a second public syntax:

```ts
workflow({
  when: repository.pushed,
});
```

This is an autocomplete and hover aid, not a second workflow language.

### Hover documentation

Every public function, property, options type, result type, event constant, and literal domain needs TSDoc that survives into the published declaration files. Hover copy should state:

- What the method does.
- Which subjects and triggers support it.
- What each parameter accepts.
- Which fields are required.
- What preview does with the action.
- Relevant forge limitations.
- One minimal TypeScript example.

Example:

```ts
/**
 * Locks the issue or change-request conversation.
 *
 * Preview reports the proposed lock but never applies it.
 *
 * @param options - Optional forge-supported lock reason.
 *
 * @example
 * ```ts
 * lockConversation({ reason: "resolved" })
 * ```
 */
export function lockConversation(
  options?: LockConversationOptions,
): ActionStep<"issue" | "change-request">;
```

The target experience is that typing `when:`, `require:`, or an action prefix leads a developer to a valid workflow without requiring the documentation site.

## Compilation and admission

Workflow source is trusted local TypeScript. Loading it executes top-level code; the SDK and CLI must document that this is not a sandbox.

The accepted pipeline is:

```text
typed workflow source
  -> TypeScript checking
  -> SDK authoring values
  -> runtime compiler and Zod validation
  -> canonical WorkflowDefinition DAG
  -> graph and compatibility validation
  -> preview or push
```

A file is not pushable merely because it imported successfully. It must pass:

1. TypeScript checking.
2. Runtime schema validation.
3. Event, rule, setting, action, and schedule validation.
4. Stable step-ID and reference resolution.
5. Graph validation.
6. Trigger and action compatibility.
7. Rule-version compatibility.
8. Repository capability checks.
9. Server authorization and permission checks.
10. Stable workflow identity matching.

Expected authoring failures are structured compile issues. SDK defects may throw. TypeScript is an authoring aid, not a security boundary.

## Preview contract

The authenticated client should follow the Context-style resource vocabulary:

```ts
import Tripwire from "@tripwire-sh/sdk";
import contributionReview from
  "./.tripwire/workflows/contribution-review.ts";

const tripwire = new Tripwire();

const result = await tripwire.workflows.preview({
  repo: "acme/widgets",
  definitions: {
    "contribution-review": contributionReview,
  },
  target: {
    changeRequest: 142,
  },
});
```

The client reads its credential from the documented environment variable by default and accepts an explicit override. Preview uses the same authenticated service and evaluation behavior as the CLI.

Preview never executes forge mutations, publishes definitions, changes enabled state, or creates a moderation request. It may perform forge reads and paid AI evaluation. Its result distinguishes:

- matched from not applicable;
- passed from failed rules;
- could not evaluate from not reached;
- policy outcomes from evaluation errors;
- proposed actions from executed actions;
- human-review requirements from real moderation work.

Transport and authentication failures may throw typed client errors. Policy and applicability outcomes remain structured values.

## Workflow CLI grammar

The configured workflow directory is the default source. Stable slugs select workflows. `--file` is an explicit source override.

```sh
tripwire workflows pull
tripwire workflows pull contribution-review

tripwire workflows validate
tripwire workflows validate contribution-review

tripwire workflows diff
tripwire workflows diff contribution-review

tripwire workflows push
tripwire workflows push contribution-review
tripwire workflows push contribution-review --file .tripwire/workflows/contribution-review.ts

tripwire workflows preview
tripwire workflows preview contribution-review
tripwire workflows preview contribution-review scheduled-cleanup --pr 142
tripwire workflows preview contribution-review --pr 142 --json
```

The durable grammar is:

```text
tripwire workflows <verb> [SLUGS...] [--file PATH]
```

Rules:

- No slugs means every configured workflow.
- Slugs select only those stable workflow keys.
- `--file` overrides discovery explicitly and must compile to exactly one workflow.
- Unknown slugs fail with suggestions.
- The same selection rules apply to pull, validate, diff, push, and preview where the operation supports them.
- `--yes` expresses consent only. It never selects all workflows.
- `--all` expresses target selection only. It never grants consent.
- `--force` overrides a documented conflict. It is never general consent.
- Local absence never means remote deletion.

## CLI execution contract

The Vercel review found that the current CLI has good foundations but does not yet provide a safe, stable automation contract. The repair should begin with one shared execution model rather than command-specific patches.

### Mode, targeting, and consent

Output mode, interactivity, selection, consent, and conflict override are separate dimensions:

- `--json` changes output format only.
- `--non-interactive` disables prompts only.
- `--agent ID`, workflow slugs, or resource arguments select targets.
- `--all` deliberately selects every valid target.
- `--yes` consents to the already-selected consequence.
- `--force` overrides a named conflict or stale-state refusal.

Non-TTY execution must never widen a target. Installation requires `--agent ID` or explicit `--all --yes` when a picker cannot run.

Consequential operations must show the exact repository, resource, and effect before prompting. When prompting is impossible, they require `--yes`. Especially severe operations may require exact-name confirmation. Prompts render on stderr.

### Streams and JSON

Human mode:

- Machine-consumable primary results go to stdout.
- Prompts, progress, warnings, receipts, review links, and next steps go to stderr.
- A mutation that creates one resource prints the bare resulting identifier on stdout.

JSON mode:

- Success writes exactly one JSON value to stdout and nothing to stderr.
- Failure writes nothing to stdout and one single-line JSON error to stderr.
- Stable fields include `status`, `reason`, `message`, `next`, `data`, `requestId`, and retry metadata where applicable.
- Human and JSON modes select and mutate the same targets.

Exit codes:

- `0`: command completed under its documented contract. A previewed policy block or no-match result can still be a successful command.
- `1`: operational failure.
- `2`: usage or validation error.
- `130`: cancellation or interrupt.

### Cancellation, deadlines, and uncertain mutations

Every request and child process needs an abort signal. The CLI needs:

- Per-request timeouts.
- Total operation deadlines.
- Bounded retries classified by retryability.
- Ctrl+C propagation and cleanup.
- `--timeout` for review waiting.
- An explicit unknown-outcome result when a mutation may have reached the server.

Review polling cannot continue forever. Retrying a read is different from replaying a mutation.

### Parsing and command grammar

Commander metadata should be the single parser and help source. Remove the manual argv router that currently swallows invalid flags.

Required corrections:

- Invalid or incomplete flags are usage errors.
- Command groups that display valid help exit `0`.
- Nested help resolves the complete command path.
- Numeric flags reject non-numbers, negative values, and values outside documented bounds before authentication or transport work.
- Conflicting flags are declared as conflicts.
- Replace ambiguous shapes such as `<repoOrRule> [ruleId]` and `<first> <second> [third]` with one stable resource positional plus `--repo`, or a clear nested resource path.
- `rules list` keeps one meaning. Use `rules catalog` for the global catalog.
- Every list command supports validated `--limit`, `--next`, and a safe `--all` where appropriate.
- Add `--cwd` so automation can select project context without changing process directories.
- Standardize browser suppression as `--no-open`, keeping `--no-browser` only as a temporary deprecated alias.

### Terminal safety and presentation

Sanitize remote text once at the rendering boundary. Remove or escape ANSI controls, terminal escape sequences, bidi controls, and unsafe invisible characters while preserving useful Unicode.

Presentation requirements:

- Non-TTY tabular output uses a machine-friendly stable delimiter rather than space padding.
- Human tables adapt to 40, 80, and 120-column terminals.
- Width calculation handles wide Unicode and combining characters.
- Empty lists retain a stable stdout shape; explanatory context goes to stderr.
- Honor `--no-color`, `NO_COLOR`, `FORCE_COLOR`, and `TERM=dumb`.
- Provide an accessible plain presentation mode.
- Update notices and client/server version-skew warnings never corrupt stdout contracts.

### Durable local state and credentials

- Report installer steps independently so partial installation is visible and recoverable.
- Do not print `Installed` before every required step has succeeded.
- Write project links and configuration atomically with exclusive temporary files and replacement.
- Lock credential refresh across processes so rotating refresh tokens cannot race.
- Apply an explicit user-only ACL to any Windows plaintext credential fallback.
- Report remote token revocation and local credential deletion as separate logout outcomes.

## Current CLI release blockers

The review identified six blockers:

1. Installation can target every detected agent without explicit target selection and consent.
2. `--json` does not provide one dependable machine interface across success, failure, version, parsing, and unknown-command paths.
3. Consequential operations such as rule deletion and moderation removal lack a shared consent preview.
4. Prompts use the wrong stream, cancellation exits successfully, and piping stdout can silently change selection to every workflow.
5. Requests, review waits, and child processes lack bounded deadlines and complete abort propagation.
6. Server-controlled text reaches the terminal without centralized sanitization.

High-priority correctness gaps include invalid flag handling, group and nested help, numeric and conflict validation, directory-dependent command meaning, ambiguous resource grammar, pagination, and incomplete help.

## Recommended implementation order

1. Keep the approved standalone package and monorepo governance amendment aligned.
2. Finish reusable workflow authoring runtime, types, compilation, and catalog typing in `tripwire-typescript-sdk`.
3. Add the one-file-per-workflow loader and `.tripwire/workflows/<slug>.ts` discovery while preserving the current key-to-ID map.
4. Build one shared CLI execution contract for mode, streams, JSON, errors, consent, cancellation, and deadlines.
5. Remove manual argument routing and repair help, exit codes, conflicts, numeric validation, resource grammar, and pagination.
6. Correct installer targeting and add consequential-action previews.
7. Add terminal sanitization, bounded transport, atomic writes, credential locking, and truthful partial outcomes.
8. Implement shared programmatic preview, then make the CLI load local definitions and format that structured result.
9. Rework terminal tables, color and accessibility behavior, command help, completion metadata, and end-user documentation.

Do not add a second evaluation engine to the CLI. Do not introduce arbitrary callbacks or another workflow language. Do not publish, deploy, or mutate live workflows as part of this implementation without separate authorization.

## Verification requirements

SDK and workflow files:

- Real consumer imports against package exports.
- Type inference and compile-failure fixtures for every event, rule, setting, action, schedule field, output port, and compatibility rule.
- Runtime validation for untyped and malicious inputs.
- Simple and complex graph round trips.
- Stable workflow and step identity.
- Rule-version preservation.
- File discovery, slug selection, invalid paths, traversal attempts, collisions, and duplicate slugs.
- Pull protection for local edits.
- Push idempotency and enabled-state preservation.
- Preview action suppression and structured outcome distinctions.

CLI public behavior:

- Every command in human and JSON modes.
- TTY and non-TTY stdin, stdout, and stderr independently.
- 40, 80, and 120-column terminals.
- Windows, Linux, and macOS behavior.
- Usage, operational, cancellation, timeout, and unknown-outcome exits.
- Hostile remote text including ANSI, bidi, control, wide, and combining characters.
- Partial installer failure and recovery copy.
- Concurrent credential refresh.
- Interrupted atomic writes.
- Client/server version skew.

The prior CLI review confirmed parser, help, JSON, group-exit, and numeric-validation defects against the built executable. Typecheck and production bundling passed. Its full CLI test attempt reported 344 passes, 39 failures, and 1 error under Bun 1.2.20, while the repository pins Bun 1.4.4. Rerun the suite under Bun 1.4.4 before treating it as a product result.

## Open implementation decisions

- Define the authenticated client export only after its server contract exists; the initial package root re-exports workflow authoring.
- Define the additive discovery field in `.tripwire/project.json`; do not create a second configuration file.
- Define the server preview capability, authorization, cost controls, and consistent subject snapshot contract before scaffolding transport.
- Decide which compatibility rules TypeScript can express cleanly and which remain runtime compiler errors. Runtime enforcement is required in both cases.
- Define catalog version compatibility so an SDK upgrade cannot silently reinterpret an older workflow.


## Repository stars on staging

Install the owned repository check as a standalone rule on the staging scratch repo:

```sh
tripwire-staging --org grim rules set scratch owned-repo-stars \
  --enable --param minStars=50000 --param min=1
```

The rule requires the pull request author to own at least one public GitHub repository with 50,000 stars or more. A standalone rule blocks on a failed check. Use the rule in a workflow if you want a different action. The merged pull request variant is `merged-pr-repo-stars`; set `minRepoStars`, `min`, and `repoOwnership=exclude-author` to count only merges into repositories the author does not own.

In a workflow, change the star threshold or ownership setting in Properties, save, and pull again. Pull generates the SDK helper with the saved values. `50_000` in TypeScript is the number `50000` in the workflow graph. Adding a new kind of evidence requires a forge read, a rule, and typed SDK support; editor settings do not add SDK methods.

The staging CLI at `0.1.22-staging.24` accepted SDK `0.1.2` and wrote a file with imports that version did not export. CLI `0.1.23-staging.26` and newer require SDK `0.1.4` or its staging prerelease for these workflows and stop before writing files if the installed SDK is too old.

```sh
npm install -g @tripwire-sh/cli@staging
npm install @tripwire-sh/sdk@staging
tripwire-staging --org grim workflows pull star-check-owned
```

SDK changes on the staging branch publish to npm's `staging` tag after CI. The release workflow uses the version in `package.json`; a stable release from `main` requires a version bump. CLI release CI installs the selected channel's SDK and checks that both star workflows pull and compile back to the same graph before publishing. CI publishes packages to npm. The installed CLI and project SDK update when you run the install commands above.
