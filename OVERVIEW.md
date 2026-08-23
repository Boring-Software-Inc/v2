# tripwire

a firewall for your repo.

tripwire reads every incoming change request and decides whether it is safe.
it then blocks it, passes it, or sends it to a human. this happens before a
maintainer ever opens it.

it works on github and on open-git.

---

## the problem

an open repository takes changes from strangers. most are fine. some are spam,
some are a wallet address swapped into a config file, and some are an account
made an hour ago.

a maintainer reads all of them. that is the cost of being open, and it is the
part that does not scale.

---

## what tripwire does

1. a change request arrives. the forge sends a webhook.
2. tripwire runs a set of **rules** against it.
3. a **workflow** combines those results into one verdict.
4. tripwire writes a **check** on the commit and comments on the thread.

three verdicts:

| verdict | what happens |
| --- | --- |
| pass | the check goes green. nobody is interrupted. |
| block | the check fails. the merge button is dead. |
| review | a human is asked to decide. |

the check is the gate. a failing check means the change cannot merge.

### it fails closed

if tripwire cannot read what a rule needs, that rule declines. it does not
guess, and it never reports a pass for something it did not examine. a change
tripwire could not judge goes to a human, not through.

### every run is auditable

each verdict keeps its inputs, the result of each rule, and the evidence.
you can open a run and see why. you can replay history against new rule code
and see which verdicts would change, before you ship the change.

---

## agentic use

tripwire is built to be driven by coding agents, and most of it was.

### why it suits an agent

the repository is arranged so an agent can work in it without breaking things
it cannot see.

- **the rules are pure.** rule code does no i/o. effects are passed in. a rule
  is a plain function over a fixed input, so an agent can test one without a
  database, a network, or a forge.
- **the dependency arrows are enforced.** `bun run check:boundaries` fails the
  build on a wrong-direction import. an agent cannot quietly couple two
  packages that must stay apart.
- **the type rules are strict on purpose.** a custom lint suite rejects the
  shortcuts a language model reaches for first, such as widening a known value
  or casting through `unknown`. see `docs/agent-guidelines.md`.
- **the checks are one command each.** lint, typecheck, boundaries, tests. an
  agent can run all four and read a clear pass or fail.

### using tripwire from an agent

```
bun run rule-check      # evaluate rules against a change request
bun run replay          # re-run stored history against current rule code
```

`replay` is the important one. it answers "what would this rule change have
done to the last thousand change requests" before the change reaches anyone.

### contributing with an agent

agents are welcome here. the rules are the same as for a person, and they are
written down in `docs/agent-guidelines.md`. the short version:

1. run lint and typecheck before every push. no exceptions.
2. no `any`. no casting around a type error.
3. a ui change needs a before-and-after screenshot.
4. a commit message needs the right shape.
5. a huge pull request gets split, not reviewed.

read `docs/CONTRIBUTING.md` first. read `docs/agent-guidelines.md` second.

---

## local development

### the demo — one command, no docker

```
bun run dev:demo
```

a seeded, presentable app at `http://localhost:3000`. the web head only. the
database is embedded, in-process postgres, running the same schema and
migrations as production.

it seeds a realistic story across all three verdicts and drops you on a full
dashboard. re-running resets to the same clean state.

a dev build also has a persona switcher, at the bottom left. it jumps between
real product states: a fresh maintainer, one repo, many repos, an empty
dashboard, and the anonymous stranger view. it is excluded from production
builds at compile time.

### the full stack

```
bun run db:up          # postgres in docker
bun run db:migrate     # apply migrations
bun run dev            # web, api, worker, and a tunnel
```

`bun run dev` opens one terminal ui. arrow keys move between the web, api,
worker, and tunnel panes.

the tunnel pane prints a public url routed to the api. point your forge app's
webhook at `<that-url>/webhooks/github` or `<that-url>/webhooks/opengit` to
receive local deliveries.

smaller pieces:

```
bun run dev:local      # the same, without the tunnel
bun run dev:web        # the web head only
bun run dev:api        # the api head only
bun run dev:worker     # the queue consumer only
```

set `BETTER_AUTH_SECRET` to turn on real sign-in and the auth gates. leave it
unset for an open local posture.

---

## checks

run these four before you push. continuous integration runs the same four.

```
bun run check              # format and lint
bun run typecheck          # every package
bun run check:boundaries   # the dependency arrows
bun test                   # unit and integration tests
```

---

## live end-to-end tests

`bun test` proves the logic against a fake forge. a separate harness proves the
real thing against a real forge, on a sacrificial repository.

it needs real credentials, a running worker, and a tunnel. it is a pre-release
tool. it does not run on each pull request.

```
bun run test --list         # the github scenarios
bun run test --everything   # all of them, with a summary
```

open-git has its own harness. it never closes a pull request, because open-git
has no page for a closed one, so a closed pull request cannot be read.

```
bun run scripts/e2e/opengit.ts --list
```

what is deliberately not automated: whether the comment copy READS well. the
harness proves the mechanics. a human reads the thread once. taste stays human.

---

## docs

| file | what it covers |
| --- | --- |
| `docs/CONTRIBUTING.md` | setup, checks, commits, tests |
| `docs/agent-guidelines.md` | rules for agent contributors |
| `docs/opengit-progress.md` | what open-git still needs |
| `docs/LICENSE-EXPLAINED.md` | the license in plain words |

---

## license

mit. see `LICENSE`, and `docs/LICENSE-EXPLAINED.md` for what it means.
