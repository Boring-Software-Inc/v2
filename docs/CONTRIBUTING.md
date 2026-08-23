# contributing

how to work in this repository. every command below is real and is in
`package.json`. ci runs the same checks, so a green machine means a green
pull request.

---

## 1. set up

you need bun, docker, and git.

```
bun install          # also installs the commit-msg hook
bun run db:up        # starts postgres in docker
bun run db:migrate   # applies the schema
```

copy `.env.example` to `.env` and fill it in. the file explains each value.
tripwire starts without most of them. a missing credential turns one feature
off. it never makes tripwire accept something it cannot check.

```
bun run dev          # web, api, worker, and a tunnel
```

---

## 2. before you push

run these four. ci runs the same four, in this order.

```
bun run check              # biome — format and lint
bun run typecheck          # every package
bun run check:boundaries   # the dependency arrows
bun test                   # unit and integration tests
```

`bun run check --write` fixes most format problems for you.

---

## 3. the dependency arrows

this is the one rule the build enforces for you.

```
contracts     ← everything            (imports nothing but zod)
utils         ← everything except contracts
forge         ← the adapters, worker  (interface and types only)
core          ← worker only           (pure — no i/o, no db, no network)
db            ← worker, api, web
auth          ← web, api
forge-github  ← worker, api
forge-opengit ← worker, api
ui            ← web
```

three laws:

1. apps import packages. packages never import an app.
2. nothing imports `core` except `worker`.
3. an adapter never imports another adapter.

`scripts/check-boundaries.ts` fails the build on a wrong-direction import. if
your work does not fit an existing package, stop and ask. do not add a new
top-level package without a `DECISIONS.md` entry.

### why core is pure

`core` holds the rules. it does no i/o at all. the worker passes effects in.

a rule is therefore a plain function over a fixed input. its test needs no
database and no network.

---

## 4. naming

- files are kebab-case: `event-list.tsx`, `account-age.ts`
- components are pascalcase. hooks start with `use-`
- constants are screaming_snake_case
- types are pascalcase. a props type ends in `Props`
- a rule id is kebab-case with a version: `some-rule@1`
- database columns are snake_case
- add a barrel `index.ts` at three or more exports
- never re-export from a file that is not a barrel

imports are absolute. use `#/` inside `apps/web` and `@tripwire/*` across
packages. never write `../../..`.

---

## 5. commits

a commit message needs a type. a task id is optional.

```
fix: correct the timeout
MDN-42 fix: correct the timeout
MDN-42 fix(api): correct the timeout
```

allowed types: `build`, `chore`, `ci`, `design`, `docs`, `feat`, `fix`,
`perf`, `refactor`, `revert`, `style`, `test`.

the header has a limit of 100 characters. the `commit-msg` hook checks the
message. `bun install` installs the hook. `--no-verify` skips it.

put the task id in a pull request title too. that closes the task
automatically.

### write the why, not the what

the diff shows what changed. a message should say why. name the behaviour that
was wrong, and what it does now.

---

## 6. tests

run one package:

```
cd packages/core && bun test
```

three kinds of test live here.

| kind | where | needs |
| --- | --- | --- |
| unit | next to the source | nothing |
| integration | `*.integration.test.ts` | postgres |
| live e2e | `scripts/e2e/` | real credentials |

the live e2e drives real pull requests on a real repository. it is a
pre-release tool, not a per-pull-request check. ci does not run it.

```
bun run test --list          # the github scenarios
bun run test --only <name>    # one of them
```

the github harness leaves a pull request open when you pass `--keep`. the
interactive run asks before it closes anything.

the open-git harness never closes a pull request, and has no way to. open-git
has no closed-pull-request page, so a closed one cannot be read.

```
bun run scripts/e2e/opengit.ts --list
```

### a test must be able to fail

a test that passes when the code is broken is worse than no test. delete a line
of the code under test and check that the test goes red.

---

## 7. what a good change looks like

- it does one thing
- it explains why in the commit message
- it adds a test that fails without it
- it passes the four checks in section 2
- it says out loud what it decided on your behalf

if you find a second problem while fixing the first, write it down and fix it
separately. do not widen a change because you are already in the file.

### fail closed

tripwire gates other people's code. when tripwire cannot check something, it
must say so and hold. it must never pass a change it did not examine. a rule
that cannot read what it needs SKIPS. it does not guess, and it does not
report a pass.

---

## 8. asking for a review

open a pull request against `main`. put the task id in the title.

in the description, answer three questions:

1. what was wrong
2. what you changed
3. what you decided that a reader might disagree with

the third matters most. a reviewer can read a diff. a reviewer cannot read
your reasoning.
