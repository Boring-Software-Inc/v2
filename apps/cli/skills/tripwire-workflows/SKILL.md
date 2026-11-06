---
name: tripwire-workflows
description: Write and change Tripwire workflows as TypeScript. Use when the user wants to add, change, or understand a workflow, gate, schedule, or automation.
---

# Tripwire workflows as code

Each workflow has a TypeScript file under `.tripwire/workflows/`. The filename
is its slug. Tripwire checks the code before sending the workflow for review.

## Steps

1. **Pull.** Run `tripwire workflows pull --repo acme/widgets`. To pull one
   workflow, pass its slug, for example `tripwire workflows pull new-contributors`.
   After the first pull, `.tripwire/project.json` records the repo and maps
   filenames to remote workflow IDs. Keep the filename when renaming a workflow.
2. **Edit.** Install `@tripwire-sh/sdk` and TypeScript in the project. During
   SDK development, install from a local build. Pull generates
   `defineWorkflow(...)` files to preserve the saved graph. Use `workflow(...)`
   and the SDK helpers when authoring a workflow from scratch.
3. **Validate and compare.** Run `tripwire workflows validate new-contributors`
   and `tripwire workflows diff new-contributors`. Show the user the diff before
   pushing. Omit the slug to select every workflow file.
4. **Push.** Run `tripwire workflows push new-contributors`. It checks TypeScript
   and sends the compiled workflow for review. Give the user the review link.
   New workflows start off. Use `--force` to save without review only when the
   user asks.

Loading workflow files needs Bun or Node 22.18+. On older Node, use
`bunx @tripwire-sh/cli`. If `npx` stops with `EBADDEVENGINES`, the repo's
`package.json` has a `devEngines` field that npm enforces. Use
`bunx @tripwire-sh/cli`, or `npx --prefix ~ @tripwire-sh/cli`, which runs in
the same folder. Without the CLI, the MCP tools `get_workflow`,
`validate_workflow`, `propose_workflow_push` and `apply_workflow` do the same
with compiled JSON. Over the MCP, call `begin_workflow_work` before you build
so the user can watch the draft in the app, and `finish_workflow_work` when
you stop. A draft never runs. An accepted push or an apply saves the draft.
If the MCP cannot see the repo, call `whoami`. If its GitHub login is the
wrong account, call `switch_account` and give the user the reconnect step.

## SDK example

```ts
import { accountAge, block, changeRequest, workflow } from "@tripwire-sh/sdk/workflows";

export default workflow({
  when: changeRequest.opened,
  require: accountAge({ minDays: 30 }),
  otherwise: block(),
});
```

## Legacy collection reference

Use the examples below only when maintaining a legacy collection. Pass
`--file tripwire.ts` explicitly to pull, validate, diff, or push it.

```ts
import { anyOf, block, check, requestReview, workflow, workflows } from "./.tripwire/workflow.ts";

export default workflows({
	"new-contributors": workflow({
		name: "New contributors",
		on: "change-request.opened",
		check: anyOf(
			check("account-age", { minDays: 7 }).fails,
			check("pr-rate-limit", { maxPerWindow: 5, windowHours: 24 }).fails,
		),
		pass: [block()],
		fail: [requestReview({ reviewers: ["octocat"] })],
	}),
});
```

**Outcomes.** A check *passes* when the contributor is fine. `step.fails` is
its Doesn't pass output, `not(passes)`, and it fits anywhere a check fits, so
"if any of these doesn't pass, block" is `anyOf(a.fails, b.fails)` with
`pass: [block()]`. `not(x)` is an explicit Not gate for the same idea.
`pass` actions run when `check` passes, `fail` actions when it does not.

**Skip when.** In the app, a rule group reads "If any of these rules fail"
and can have a Skip when in front of it. If the Skip when matches, the group's
rules are skipped. Otherwise they run as normal. In code that is
`unless(group, skipWhen)`: the first argument is the group (one check, or
`allOf(a, b)` for several), the second the Skip when (a check, `allOf(...)` or
`anyOf(...)`). Order matters. It fails closed: if the Skip when errors, is
skipped or has no proof, the rules run. Put the outcome on its `fail` side:

```ts
const on = trigger("change-request.opened", "change-request.updated");
const releasePr = allOf(
	customCheck("custom-target-release"),
	customCheck("custom-release-source"),
	customCheck("custom-release-author"),
);
export default workflows({
	target: workflow({
		on,
		check: unless(customCheck("custom-target-main"), releasePr),
		fail: [requestFix({ message: "Change the target to main." })],
	}),
	crypto: workflow({ on, check: check("crypto-address"), fail: [block()] }),
});
```

Keep other rules in their own group so the Skip when never skips them. A run
shows a skipped group as skipped, with the Skip when checks as evidence, never
as passed.

The Skip when's own rules can stay uninstalled: a workflow runs the rules it
uses.

**Ids are the code's ids.** Rules: `check("<rule id>", settings)`, typed from
the catalog; `list_rule_catalog` lists them. A repo's custom rules:
`customCheck("custom-...")`. Events: `change-request.opened`,
`change-request.updated`, `change-request.closed`, `comment.created`, `push`.
A wrong id or setting fails type-checking and validation, with the right one
named.

**Actions.** `block()`, `requestFix({ message })` (red check and the
instruction, no GitHub review), `note({ message })` (green check, the note in
the comment), `label({ labels })`, `removeLabel({ labels })`,
`requestReview({ reviewers, teamReviewers })`, `postComment({ message })`,
`lock({ reason })`, `close()`, `webhook()`, `discord()`, and
`humanReview({ approve: [...], deny: [...] })`, which waits for a maintainer.
Webhook and Discord URLs are set in the app by the user, never in code.

**Unknown results.** A rule that cannot evaluate is skipped. A skipped check
fires no action through any port or gate, so it never blocks. A step that
waits on a skipped check is skipped too. A check that is never reached, because
an earlier check sent the run another way, does not pass in `allOf` or
`anyOf`.

**Wiring beyond one condition.** Name steps in `steps: { ... }`; the key is the
step id. `.after(x)` runs a check or action after a trigger or an output:

```ts
const opened = trigger("change-request.opened");
const age = check("account-age", { minDays: 30 }).after(opened);
workflow({ steps: { opened, age, stop: block().after(age.fails) } });
```

**Schedules.** `on: schedule({ every, timezone, match })`.

- `every`: `{ n: 12, unit: "hours" }`, a preset such as
  `{ preset: "daily", at: "07:00" }`, `{ preset: "weekly", on: "monday",
  at: "09:00" }`, or `{ cron: "0 9 * * 1-5" }`.
- `timezone`: an IANA name such as `"Europe/Berlin"`. Without it, clock
  schedules run in UTC. Set it whenever the user names a local time.
- `match`: `{ subjects: ["issue"], state: "open", inactiveFor: { n: 15,
  unit: "days" }, labels, excludeLabels }`.
- Use `run: [...]` for actions straight after the trigger.

## Custom rules

When no built-in rule checks what the user wants, make a custom rule. A custom
rule reads one signal and passes when its comparison holds. Ask the user
before you save one.

```sh
npx @tripwire-sh/cli rules create <repo> --name "Not into release" \
  --definition '{"when":{"id":"pr.targetBranch"},"comparison":{"kind":"noneOf","args":[["release"]]}}'
```

It prints the rule's id and its sentence, here `require that target branch is
not release`. Show the user the sentence. `rules update <repo> <id>` changes a
rule in place and keeps its id. `rules delete <repo> <id>` deletes it; a rule a
workflow uses cannot be deleted. `rules list <repo>` shows each rule's
sentence. Over the MCP, the tools are `save_custom_rule`, `delete_custom_rule`
and `get_repo_rules`. The `save_custom_rule` description lists every signal
and comparison.

A new rule is not installed. An installed rule that no workflow uses runs by
itself on every change request and blocks when it does not pass. Rules are
plain checks: Ask author to fix, Human review, Note only, Close and Skip when
belong to workflows. To combine rules or do anything but block, leave them
uninstalled and use them in `tripwire.ts`. For example, to block change requests into `release` unless
the source branch comes from release-please, make a second rule
`{"when":{"id":"pr.sourceBranch"},"comparison":{"kind":"startsWith","args":["release-please"]}}`,
then:

```ts
"release-branch": workflow({
	name: "Release branch",
	on: "change-request.opened",
	check: allOf(
		customCheck("custom-not-into-release-1a2b3c").fails,
		customCheck("custom-from-release-please-4d5e6f").fails,
	),
	pass: [block()],
}),
```

Text comparisons are `equals`, `has` (contains), `startsWith`, `endsWith`,
`containsAny`, `oneOf` and `noneOf`. Use `startsWith` for a prefix. Never use
`has` as a prefix check: it matches anywhere in the text, so
`feature/release-please-x` would pass. There is no regex, and text compares
are case sensitive. Validate with `--repo` so the ids
are checked against the repo, then diff and push as usual.
