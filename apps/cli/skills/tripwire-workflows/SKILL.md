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
   `tripwire.ts` and the typed helpers in `.tripwire/workflow.ts`. Done when
   both files exist. Read `tripwire.ts` before you change it: the canvas and
   other people edit the same workflows. To pull only some, name them:
   `workflows pull <repo> <id> <id>`. Workflows already in the file that you
   did not name stay as they are.
2. **Write.** Edit `tripwire.ts` with the reference below. Keep each workflow's
   key: it is the workflow's id, and a new key makes a new workflow.
3. **Validate until clean.** `npx @tripwire-sh/cli workflows validate --repo
   <repo>`. Every message names the step and, for a wrong id, the right one.
   Fix and rerun. Done when every workflow says `can be turned on` and each
   `runs` line reads back the schedule the user asked for, timezone included.
4. **Diff.** `npx @tripwire-sh/cli workflows diff <repo>`. Show the user the
   lines and ask before you push.
5. **Push.** `npx @tripwire-sh/cli workflows push <repo>`. New workflows start
   off. Turn one on only when the user says so:
   `npx @tripwire-sh/cli workflows enable <repo> <id>`.

Loading `tripwire.ts` needs Bun or Node 22.18+. On older Node, use
`bunx @tripwire-sh/cli`. Without the CLI, the MCP tools `get_workflow`,
`validate_workflow` and `apply_workflow` do the same with compiled JSON.
Over the MCP, call `begin_workflow_work` before you build so the user can
watch the draft in the app, and `finish_workflow_work` when you stop. A draft
never runs.

## Reference

```ts
import { anyOf, block, check, requestReview, workflow, workflows } from "./.tripwire/workflow.ts";

export default workflows({
	"change-request-opens": workflow({
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
