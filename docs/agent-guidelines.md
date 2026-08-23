# agent guidelines

rules for a coding agent working in this repository. a human contributor
should follow them too. an agent has less excuse to miss one, because every
rule below is a command it can run.

read `CONTRIBUTING.md` first. this file adds to it.

---

## 1. lint and typecheck before every push

not before the pull request. before the push.

```
bun run check              # format and lint
bun run typecheck          # every package
bun run check:boundaries   # the dependency arrows
bun test                   # unit and integration tests
```

all four must pass. continuous integration runs the same four in the same
order, so a green machine means a green pull request.

`bun run check --write` fixes most format problems.

### why the push, not the pull request

a broken commit in the history is harder to remove than a broken pull request.
push a branch that already passes.

---

## 2. no `any`, and no casting past an error

`any` is banned. so is a cast that exists only to silence the compiler.

these are all the same mistake:

```ts
const value = input as any
const value = input as unknown as Thing
const value = (input as Record<string, unknown>).field
```

each one tells the compiler to stop helping. when a type does not fit, the type
is telling you something true. read it.

### run the strict suite

```
bun run lint:slop:changed   # the changed lines only
bun run lint:slop           # everything
```

this is a custom rule set, and it is strict on purpose. it rejects the
shortcuts a language model reaches for first:

| rule | what it stops |
| --- | --- |
| `no-chained-type-assertions` | `as unknown as T` |
| `no-known-value-widening` | losing a literal type for no reason |
| `no-unknown-parameters` | `unknown` where a real type belongs |
| `no-unknown-type-aliases` | the same, behind an alias |
| `no-unsafe-dictionary-type` | `Record<string, unknown>` as a shrug |
| `no-widen-then-assert` | widening a type, then asserting it back |
| `no-runtime-typeof` | a runtime check that a type already proves |
| `no-object-parameters` | an options bag where arguments are clearer |
| `no-conditional-empty-object-spread` | `...(x ? y : {})` |
| `no-shape-in-symbol-names` | a name that repeats its own type |

every one of these is a real pattern that passed review before the rule
existed. none is a style preference.

### when you cannot type something

say so. leave the honest type, add a comment naming what is unknown and why,
and ask. a wrong type that compiles is worse than an open question.

---

## 3. a ui change needs proof

a pull request that changes the interface must include:

- a **before** screenshot
- an **after** screenshot

a video is better for anything with more than one step: a flow, an animation,
an empty state becoming a full one, an error appearing.

### why

a screenshot of the after alone proves nothing. the reviewer cannot see what
changed. two images make the change reviewable in three seconds.

"it looks right on my machine" is not evidence. neither is a description of
what it should look like.

---

## 4. commits must be shaped correctly

```
fix: correct the timeout
MDN-42 fix: correct the timeout
MDN-42 fix(api): correct the timeout
```

allowed types: `build`, `chore`, `ci`, `design`, `docs`, `feat`, `fix`,
`perf`, `refactor`, `revert`, `style`, `test`.

the header stops at 100 characters. the `commit-msg` hook checks it.

### the body carries the why

the diff already shows what changed. an agent writing a commit message should
answer:

1. what was wrong before
2. what it does now
3. what it decided that a reader might disagree with

the third is the one humans need and agents skip.

---

## 5. keep a pull request small

a pull request should do one thing.

if a diff is very large, the cause is almost always that one change grew into
several. split it. each part should stand on its own and pass every check on
its own.

### how to split

- a refactor is its own pull request. never mix it with a behaviour change.
- a rename is its own pull request.
- a new dependency is its own pull request, with a `DECISIONS.md` entry.
- a bug found while building a feature is its own pull request.

### the rule of thumb

if you cannot describe a pull request in one sentence without the word "and",
it is two pull requests.

---

## 6. fail closed

this applies to product code, not process.

tripwire gates other people's code. when tripwire cannot check something, it
must hold, and it must say why. it must never pass a change it did not
examine.

in practice:

- a rule with missing input SKIPS. it does not guess and does not pass.
- an absent read is an error, never an empty result. an empty diff is a claim
  that no file changed, and that claim can let a bad change through.
- a value a forge does not send is left absent. it is never defaulted to a
  convenient value.

if you find yourself writing `?? 0`, `?? []`, or `?? false` on data that came
from outside, stop. ask whether an absent value is really the same as that one.

---

## 7. do not widen the task

fix the thing you were asked to fix.

when you find a second problem, write it down and raise it separately. do not
repair it because you are already in the file. an unrelated fix inside a pull
request hides both changes.

this is the rule agents break most often.

---

## 8. say what you decided

every non-obvious choice goes in the pull request description, at the top, as
its own line. not buried in a paragraph.

a decision is anything a reviewer might have chosen differently:

- a behaviour that now differs between two forges
- a default you picked
- something you left out on purpose
- a trade-off between two correct options

a reviewer can read a diff. a reviewer cannot read your reasoning.

---

## 9. verify, do not assume

before you report that something works, run it.

- "the types pass" means you ran `bun run typecheck` and read the output.
- "the tests pass" means you ran them and read the count.
- "the fix works" means you reproduced the bug first, then saw it stop.

a test that has never failed proves nothing. delete a line of the code under
test and confirm the test goes red.

if you could not verify something, say which part and why. an honest gap is
useful. a false pass is not.
