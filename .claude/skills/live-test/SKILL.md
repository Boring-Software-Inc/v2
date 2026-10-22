---
name: live-test
description: Test a Tripwire change end to end against real GitHub on the scratch repo, and produce screenshot proof. Use after a change to verdicts, PR comments, checks, reviews, redaction, workflows, reviewers, or the run page ships to production, or when asked to "test on scratch", "e2e", "live test", or "prove it works".
---

# Live test on scratch

Tripwire's unit and integration tests cover the code. This skill covers the part they cannot: what a real GitHub change request shows after production handles it. Every live test ends with screenshot proof.

## Ground rules

- Test against production only after the change is merged and deployed. Confirm the deploy first (see Before you start).
- Never print secrets. Read `DATABASE_URL`, tokens and keys inside scripts; never echo them.
- Production database: read-only by default. Any write (response config, queue jobs, migrations) needs the maintainer's go-ahead in this conversation, and every test write is undone at the end.
- Use the maintainer's gh accounts as described below. Never switch the active gh account; pass a token per command instead.
- Leave scratch clean: close every PR you open and delete its branches.

## The setup

| Thing | Value |
|---|---|
| Test repo | `Boring-Software-Inc/scratch` (public) |
| Tripwire org | `tripwire67`, app at `https://app.tripwire.sh` |
| Contributor account | `g-r-i-m`: no push access to scratch, so Tripwire checks its PRs. Opens PRs from its fork `g-r-i-m/scratch`. |
| Maintainer account | `ripgrim` (the active gh account): admin on scratch, exempt from checks |
| Prod env for scripts | `~/.tripwire-railway-env/worker.env` (`set -a && . <file> && set +a`) |

Accounts with write access to scratch skip every check. Always open test PRs as `g-r-i-m`:

```bash
export GH_TOKEN=$(gh auth token --user g-r-i-m)
```

## Before you start

1. Confirm the commit you want to test is live. List the worker, api and web deployments with the Unkey MCP (`unkey_v2_deployments_list_deployments`, project `tripwire`) and check `isCurrent` points at the merge commit.
2. Confirm only the new worker takes jobs. The worker fence elects the newest deployment with a recent heartbeat; read `worker_deployments` (read-only) and expect the current deployment id to have the latest `first_seen_at` and a heartbeat under 45s old. A worker deployed before the fence existed keeps consuming for about 30 minutes after a deploy; wait it out rather than trusting results from that window.
3. Know scratch's rules. Two workflows run on every PR: the implicit Rules workflow (the repo's Rules page) and any custom workflows. Read them from `workflow_definitions` and the run's `workflow_snapshot` before predicting a verdict. Worst verdict wins: block, then human review, then pass.

## Open a test PR

Create a branch on the fork from upstream `main`, commit a file through the contents API, and open the PR. No local clone needed.

```bash
export GH_TOKEN=$(gh auth token --user g-r-i-m)
F=g-r-i-m/scratch; R=Boring-Software-Inc/scratch
gh api -X POST repos/$F/merge-upstream -f branch=main >/dev/null
SHA=$(gh api repos/$F/git/ref/heads/main --jq .object.sha)
B=live-test-$(date +%Y%m%d%H%M%S)
gh api -X POST repos/$F/git/refs -f ref=refs/heads/$B -f sha=$SHA >/dev/null
gh api -X PUT repos/$F/contents/DONATE.md -f message="docs: add donation address" \
  -f content="$(printf 'ETH: 0x52908400098527886E0F7030069857D2E4169EE7\n' | base64)" -f branch=$B >/dev/null
gh pr create --repo $R --head g-r-i-m:$B --base main --title "<what this tests>" --body "<what you expect>"
```

Name the PR after what it proves, for example `redaction 6: Rule names hidden`, so the PR list is the test log.

Content that reliably trips rules: a crypto address (Crypto address rule), non-Latin text in the title (English only), a change to `.github/workflows/**` (Honeypot paths). Opening many PRs in a row trips the rate limit rule and changes the lead reason; space them out or expect it.

## Wait for Tripwire, then read what it posted

Do not chain sleeps. Poll until the bot comment exists, then read all three surfaces:

```bash
N=<pr number>
for i in $(seq 1 45); do
  c=$(gh api repos/$R/issues/$N/comments --jq '[.[]|select(.user.login=="tripwire-sh[bot]")]|length')
  [ "$c" -gt 0 ] && break; sleep 4
done
HEAD=$(gh pr view $N --repo $R --json headRefOid --jq .headRefOid)
gh api repos/$R/commits/$HEAD/check-runs --jq '.check_runs[]|select(.name=="tripwire")|{status,conclusion,summary:.output.summary}'
gh api repos/$R/issues/$N/comments --jq '[.[]|select(.user.login=="tripwire-sh[bot]")][-1].body'
gh api repos/$R/pulls/$N/reviews --jq '.[]|{state,body,submitted_at}'
```

Then read the run itself. The comment's link holds the run id (`/runs/<id>`); `runs`, `run_steps`, `run_actions` and `moderation_items` show which workflow and rule produced what.

## What to check

| Area | Check |
|---|---|
| Verdict | Check conclusion matches the expected verdict: `failure` for blocked, `in_progress` while waiting for human review, `success` for passed. |
| Comment | One bot comment, edited in place across pushes. Wording follows `.claude/rules/constitution.md`. |
| Review | At most one `CHANGES_REQUESTED` review while blocked, edited on later blocking runs, dismissed on pass. |
| Redaction | The comment, check and review show only what the repo's level allows. The run page applies redaction live from the current setting, so check it at the level under test. |
| Run page | Signed out, it shows only public data for the level; signed in as a member, everything. |
| Transitions | Push a commit that flips the verdict and confirm the old comment and review update or dismiss as designed. |

## Design fixtures that show the difference

A test only proves something if the thing it changes is on the page. Before opening PRs, list what each variant should hide or show, and make sure the fixture contains it. For redaction, one fixture has to exercise every item the levels remove:

| Level hides | The fixture needs |
|---|---|
| Matched values | A rule that matches values, for example a crypto address in a file |
| File paths | A failing rule whose reason or evidence names a file |
| Evidence | Evidence on a failing rule (matches, findings) |
| AI summary | A failing AI review with a summary and findings |
| Reasons | Failing rules with real reasons |
| Rule names | Two or more failing rules, including a custom rule |
| Passed count | Two or more passing rules |

Also:

- Keep some rules passing on purpose. A run where everything fails cannot show what "Passed count hidden" removes.
- Read the run after the first PR and check every row of the table above is present. If one is missing, fix the fixture before opening the rest.
- Space PRs out or expect the rate limit rule to fire and become the lead reason. Note it in the report if it does.
- On the run page, expand every disclosure (evidence, AI trace, passed rules) before the screenshot. A collapsed disclosure hides exactly the data the lower levels remove, so a collapsed screenshot proves nothing.

## Proof (always)

Every live test produces screenshots. Text output alone is not proof.

1. **The PR**: screenshot the GitHub PR conversation page showing the bot comment, the review and the check. Scratch is public, so a signed-out browser works.
2. **The run**: screenshot the run page at `https://app.tripwire.sh/runs/<id>` in a fresh signed-out session (`agent-browser --session <new name>`), full page, with every disclosure expanded. Add a member view only when member-only data is part of the test.
3. **Each variant**: one PR and one run screenshot per level, verdict or transition under test.

```bash
agent-browser --session proof-$N set viewport 1440 1000
agent-browser --session proof-$N open "https://github.com/$R/pull/$N"
agent-browser --session proof-$N screenshot --full /tmp/live-test/pr-$N.png
agent-browser --session proof-$N open "https://app.tripwire.sh/runs/<run id>"
agent-browser --session proof-$N screenshot --full /tmp/live-test/run-$N.png
agent-browser --session proof-$N close
```

Show every screenshot to the maintainer in the reply (`![...](/tmp/live-test/...)`), and attach them to the Tripwire PR that shipped the change with the `before-and-after` skill or `gh pr comment <n> --attach <file>`, with one line per screenshot saying what it proves.

## Changing settings for a test

Prefer the app UI as a maintainer. When a test needs a setting the UI cannot reach quickly (for example one redaction level per PR), a scripted write to production is allowed only with the maintainer's approval:

- Redaction for scratch lives in `response_configs` (`config.redaction`); build the value with `responseConfigSchema.parse(...)` from `@tripwire/contracts` so defaults fill in.
- Setting the value directly does not rewrite open PRs. Enqueue `refresh-response-surfaces { repoId }` to re-render them, or skip it on purpose to keep each PR at the level it was opened with.
- Remove the override when done and say so.

## Clean up

```bash
for n in <pr numbers>; do GH_TOKEN=$(gh auth token --user g-r-i-m) gh pr close $n --repo $R --comment "Closing test PR."; done
GH_TOKEN=$(gh auth token --user g-r-i-m) gh api -X DELETE repos/g-r-i-m/scratch/git/refs/heads/<branch>
```

`gh pr close --delete-branch` skips fork branches; delete them on the fork as above. Undo any production setting you changed and confirm it.

## Report

End with a table: what was tested, expected, actual, pass or fail, and the proof screenshot for each row. Call out anything that only partly passed and anything you could not test, with the reason.
