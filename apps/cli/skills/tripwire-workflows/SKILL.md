---
name: tripwire-workflows
description: Write and change Tripwire workflows as tripwire.ts code. Use when the user wants a workflow, a gate, a schedule or an automation added, changed or explained, or mentions tripwire.ts.
---

# Tripwire workflows as code

A workflow is typed code in `tripwire.ts`. It is a finite graph: triggers,
rule checks, gates (all of, any of, not) and actions. It always finishes, and
the compiler checks it before anything runs.

## Steps

1. **Pull.** `npx @tripwire-sh/cli workflows pull <repo>`. This writes
   `tripwire.ts`, the typed helpers in `.tripwire/workflow.ts` and the link in
   `.tripwire/project.json`. Done when the files exist. Read `tripwire.ts`
   before you change it: the canvas and other people edit the same workflows.
   To pull only some, name them: `workflows pull <repo> <key> <key>`. Workflows
   already in the file that you did not name stay as they are.

   The link holds the repo, the org and each workflow's id, no secrets, so
   commit it.
   Anywhere under that folder, `diff`, `push`, `list`, `enable` and the other
   commands can leave out `<repo>` and `--org`. An explicit `<repo>`, `--org`
   or `TRIPWIRE_ORG` wins over the link. `tripwire link <repo>` and
   `tripwire unlink` set and clear it; `tripwire status` shows it.
2. **Write.** Edit `tripwire.ts` with the reference below. Each workflow's key
   is its name as a slug, and `.tripwire/project.json` maps it to the
   workflow's id. Keep the key when you rename a workflow. A new key makes a
   new workflow.
3. **Validate until clean.** `npx @tripwire-sh/cli workflows validate --repo
   <repo>`. Every message names the step and, for a wrong id, the right one.
   Fix and rerun. Done when every workflow says `can be turned on` and each
   `runs` line reads back the schedule the user asked for, timezone included.
4. **Diff.** `npx @tripwire-sh/cli workflows diff <repo>`. Show the user the
   lines and ask before you push.
5. **Push.** `npx @tripwire-sh/cli workflows push <repo>`. It opens a review
   page in the user's browser and waits until they accept or reject it. Give
   the user the `review` link it prints. Exit 0 means accepted; on exit 1 tell
   the user why and stop. `--force` saves without review: use it only when the
   user asks. New workflows start off. Turn one on only when the user says so:
   `npx @tripwire-sh/cli workflows enable <repo> <id>`.

Loading `tripwire.ts` needs Bun or Node 22.18+. On older Node, use
`bunx @tripwire-sh/cli`. If `npx` stops with `EBADDEVENGINES`, the repo's
`package.json` has a `devEngines` field that npm enforces. Use
`bunx @tripwire-sh/cli`, or `npx --prefix ~ @tripwire-sh/cli`, which runs in
the same folder. Without the CLI, the MCP tools `get_workflow`,
`validate_workflow`, `propose_workflow_push` and `apply_workflow` do the same
with compiled JSON. Over the MCP, call `begin_workflow_work` before you build
so the user can watch the draft in the app, and `finish_workflow_work` when
you stop. A draft never runs. An accepted push or an apply saves the draft.

## Reference

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

**Ids are the code's ids.** Rules: `check("<rule id>", settings)`, typed from
the catalog; `list_rule_catalog` lists them. A repo's custom rules:
`customCheck("custom-...")`. Events: `change-request.opened`,
`change-request.updated`, `change-request.closed`, `comment.created`, `push`.
A wrong id or setting fails type-checking and validation, with the right one
named.

**Actions.** `block()`, `label({ labels })`, `removeLabel({ labels })`,
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

A new rule starts off. A rule that is on and that no workflow uses runs by
itself on every change request. To combine rules, keep them off and use them
in `tripwire.ts`. For example, to block change requests into `release` unless
they come from the release-please branch, make a second rule that lists the
exact source branch names to allow,
`{"when":{"id":"pr.sourceBranch"},"comparison":{"kind":"oneOf","args":[["release-please--branches--release"]]}}`,
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

There is no starts-with or regex comparison. Match branches by exact name
with `oneOf`. Never use `has` as a prefix check: it matches anywhere in the
text, so `feature/release-please-x` would pass. Text compares are case
sensitive. Validate with `--repo` so the ids
are checked against the repo, then diff and push as usual.
