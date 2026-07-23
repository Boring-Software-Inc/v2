# Signal expansion round 2 + two-step picker — discovery report

Status: Phase 1 discovery, approved to implement.

## The event payload (sets the whole cost column)

The normalized event (`packages/forge-github/src/webhook/normalize.ts`) stores only:
`number, title, headSha, baseRef, headRef, draft, url`, plus `actor.login`. So
branches, draft, title, and the author login are **free** (already on the event).
`body`, `maintainer_can_modify`, and reactions are **not** on the event and need a
live fetch.

Existing fetch clusters (one memoized `ctx.load` each):
`event` (free), `user` (`GET /users/{login}`), `pr-files` (`GET /pulls/{n}/files`),
`pr-commits` (`GET /pulls/{n}/commits`), `permission`, and several one-shot
`/search/issues` counts.

## Candidate table (full, amended)

| Signal | Obtainable (exact API) | Cost | Reliability | Value type | Transform/Producer | Verdict |
|---|---|---|---|---|---|---|
| `pr.targetBranch` | event `baseRef` | free (event) | always | text | producer | include |
| `pr.sourceBranch` | event `headRef` | free (event) | always | text | producer | include |
| `pr.isDraft` | event `draft` | free (event) | always | boolean | producer | include |
| `contributor.login` | event `actor.login` | free (event) | always | text | producer | include |
| `pr.commitMessages` | `pull.commits` → `commit.message` | free (`pr-commits`) | always | textList | producer | include |
| `pr.commitAuthors` | `pull.commits` → `author.login` | free (`pr-commits`) | null author → `"unknown"` | textList | producer | include |
| `pr.allCommitsByAuthor` | `pull.commits`, each `author.login` vs `actor.login` | free (`pr-commits`) | null author counts as mismatch | boolean | producer (derived) | include |
| `pr.conventionalCommits` | `pull.commits`, subjects vs CONVENTIONAL_PATTERN | free (`pr-commits`) | empty commit set → true | boolean | producer (derived) | include |
| `pr.maxCommitMessageLength` | `pull.commits`, max `message.length` | free (`pr-commits`) | empty set → 0 | number | producer (derived) | include |
| `pr.fileExtensions` | `pull.files`, distinct ext of `filename` | free (`pr-files`) | always | textList | producer | include |
| `pr.addedCommentCount` | `pull.files` `.patch` + prefix map | free (`pr-files`) | `.patch` absent (binary/huge) → file skipped | number | producer | include |
| `repoRelation.mergeRatioInRepo` | `mergedInRepo / (mergedInRepo + closedUnmergedInRepo)` | free (reuses two existing search clusters) | skip when denom 0 | number (percent) | producer (derived) | include |
| `contributor.profileCompleteness` | `GET /users/{login}`, count 10 fields | free (`user`; widen interface) | null fields count absent | number 0–10 | producer (derived) | include |
| `contributor.isPublicProfile` | `user.user_view_type === "public"` | free (`user`) | always | boolean | producer | include |
| `pr.titleIsConventional` | event title vs CONVENTIONAL_PATTERN | free (event) | always | boolean | producer (derived) | include |
| `pr.body` | `GET /pulls/{n}` → `body` | one call (new `pr-details`) | often empty → `""` | text | producer | include |
| `pr.maintainerCanModify` | `GET /pulls/{n}` → `maintainer_can_modify` | free (rides `pr-details`) | `false` for same-repo branches | boolean | producer | include |
| `pr.negativeReactions` | `GET /issues/{n}` → `reactions["-1"]+reactions.confused` | one call (new `issue-reactions`) | reactions object always present | number | producer | include |
| `pr.emojiCount` | title (event) + body (`pr-details`) | free (rides `pr-details`) | empty → 0 | number | producer, shared module | include |
| `pr.codeReferenceCount` | body (`pr-details`), 3 patterns | free (`pr-details`) | empty → 0 | number | producer, shared module | include |
| `pr.linkedIssueCount` | body (`pr-details`), 4 patterns | free (`pr-details`) | empty → 0 | number | producer, shared module | include |
| `pr.referencedIssueNumbers` | body (`pr-details`) parse → numbers | free (`pr-details`) | empty → `[]` | textList | producer, shared module | include (unlocked by `anyIn`) |
| `contributor.mergeRatioGlobal` | two `search.issuesAndPullRequests` counts | expensive (2 search calls) | skip when total 0; secondary-rate-limit prone | number (percent) | producer (derived) | include |
| `pr.bodyLength` | — | — | — | number | — | drop (= `pr.body.trimmedLength`) |
| `contributor.usernameLooksSpammy` | derived from login patterns | free | false-positives on real accounts | boolean | — | drop (ship raw `contributor.login`) |
| `pr.hasTemplate` | `GET contents` on 6 known paths | one call | template may not exist | boolean | producer | defer |
| `pr.matchesTemplate` | template + body section/checkbox validation | one call + heavy | complex | boolean | producer | defer |
| final-newline | up to 30 `getContent` at head SHA | expensive (≤30 calls) | — | — | — | drop |

Tally: **23 include, 3 drop, 2 defer.** No candidate needs elevated scope; every
check runs off public PR/user/search/content data. Private author profile is the
only real degradation (nulls profile fields, makes merge ratios meaningless) —
producers return safe defaults or skip, matching existing "unavailable so the rule
skips" behaviour.

### Why `contributor.login` raw, not `usernameLooksSpammy`

## The textList-membership gap → second verb this round

The same shape appears **three** times, so it is one verb, not a defer:

- `pr.referencedIssueNumbers` anyIn `["8154"]` — blocked issue numbers.
- `pr.commitAuthors` anyIn `[blocked logins]` — blocked commit authors.
- `pr.fileExtensions` anyIn `[".json", ".lock"]` — extension blocklisting.

**`anyIn(list: string[])` on the `textList` kind.** Semantics:
`value.some(v => list.includes(v))` — exact-match membership, the textList analog of
`oneOf`. Non-empty intersection. No regex, no substring, no ReDoS surface.

Contrast the two new verbs:
- `containsAny(list)` on **text**: `list.some(n => value.includes(n))` — substring-any.
  Powers honeypot / blocked-terms on `pr.body`, `comment.body`.
- `anyIn(list)` on **textList**: `value.some(v => list.includes(v))` — membership-any.

Both are plain string ops. Confirmed against `evaluate.ts`: every existing text verb
except `matches` is already plain (`.includes`, `.some`); we are not touching
`matches`, so no regex is introduced.

## Per-borrowed-signal: their approach, port or improve

All "port" = reimplement clean-room, preserving attribution. Exact patterns in Appendix.

- **Emoji count** — code-point `\p{Extended_Pictographic}` + shortcode regex, over
  `title + " " + body`. No grapheme clustering (ZWJ/skin-tone counts as several).
  **Improve:** segment by grapheme (`Intl.Segmenter`) so one visible emoji = 1.
- **Code references** — three patterns summed; one token can double-count; only
  empty-paren calls match. **Port as-is**, document the double-count.
- **Issue references** — four patterns into a `Set`; only the number survives.
  **Port as-is** for `linkedIssueCount` and `referencedIssueNumbers`.
- **Added-comment count** — walk `.patch`, `+` lines only, trim, test against
  `COMMENT_PREFIXES_BY_LANGUAGE[ext]`; skip block-continuation lines (`*`, `-->`) and
  diff headers. **Rebuild the prefix map from language facts** (Appendix), port the
  walk.
- **Global merge ratio** — two search counts, ratio = merged/(merged+closed), skip if
  total 0. **Port the query shape** (Appendix).
- **Per-repo merge ratio** — same, `repo:`-scoped. **Improve:** we already fetch
  `mergedInRepo` and `closedUnmergedInRepo`, so ours adds **zero** API calls.
- **Profile completeness** — 10 field-present tests, 1 point each. **Port the field
  list**; widen the `user` interface to read `name`, `blog`, `email`, `bio`,
  `twitter_username` (we already expose the other 5).
- **Conventional title / commits** — CONVENTIONAL_PATTERN (Appendix); commit subjects
  skip `Merge ` prefixes and squash `(#nnn)` suffixes. **Port as-is** for
  `titleIsConventional` / `conventionalCommits`.
- **Commit-author match** — each `commit.author.login` lowercased vs PR author; null
  author = mismatch. **Port as-is** for `allCommitsByAuthor`.

## From Coolify's workflows

Tuned values proven at 50k-star volume, each expressible with our signals:
`allowed-target-branches: next` + `blocked-source-branches: main,master,v4.x` (branch
funnel → `pr.targetBranch`/`pr.sourceBranch` + `oneOf`/`anyIn`);
`blocked-terms: STRAWBERRY, "Generated with Claude Code"` (flagship `containsAny` on
`pr.body`); `blocked-issue-numbers: 8154` (`referencedIssueNumbers` + `anyIn`);
reputation gates left at default (`min-account-age: 30`, `min-global-merge-ratio: 30`,
`require-commit-author-match: true`).

Not expressible in a single-rule signal→comparison→action model (named gaps, not this
round): `max-failures: 4` (cross-rule failure accumulator); stale-bot and lock-threads
(scheduled label sweeps); label-driven docs reminder and `@claude` agent
(human-in-the-loop / external LLM).

## Two-step picker

Area taxonomy (7), verbatim plain copy:
`The account`, `Their activity`, `This repo`, `This change`, `The PR description`
(new), `The commits` (new), `The comment`.

Signal → area (expanded set; grouping is presentation-only, ids/stored rules stable):

- **The account** — accountAge, followers, following, publicRepos, publicGists,
  profileText, company, location, hireable, profileCompleteness, isPublicProfile,
  **login**
- **Their activity** — prsOpened, mergedElsewhere, recentForkTimes,
  recentChangeRequestTimes, **mergeRatioGlobal**
- **This repo** — mergedInRepo, issuesOpenedInRepo, commentedInRepo,
  closedUnmergedInRepo, isOrgMember, isMaintainer, **mergeRatioInRepo**
- **This change** — filesChanged, changedPaths, linesAdded, linesDeleted,
  linesChanged, **fileExtensions**, **targetBranch**, **sourceBranch**, **isDraft**,
  **maintainerCanModify**, **addedCommentCount**, **negativeReactions**
- **The PR description** — **title** (relocated from This change),
  **titleIsConventional**, **body**, **emojiCount**, **codeReferenceCount**,
  **linkedIssueCount**, **referencedIssueNumbers**
- **The commits** — commitCount, verifiedCommits, allCommitsVerified,
  **commitMessages**, **commitAuthors**, **allCommitsByAuthor**,
  **conventionalCommits**, **maxCommitMessageLength**
- **The comment** — comment.body

Grouping is driven by the `group` field on `CUSTOM_SIGNALS`
(`packages/contracts/src/custom-rules-display.ts`), not by id prefix
(`contributor.*` already splits across two areas today).

Interaction: same Base UI `DropdownMenu` primitive, second data source. Add `area` to
`BuilderState`; the signal chip lists `CUSTOM_SIGNALS.filter(s => s.group === area)`.
Move the cascade reset (`signal, window, verb, value`) from the signal item's onClick
**up onto the area onClick**, keeping `severity`/`name`. "Change your mind" = reopen
the area chip and pick a different area, which drops to an empty signal chip; the
downstream chips collapse automatically (they gate on upstream truthiness). No step
index or history stack — navigation stays "reopen any chip," as today.

## Sweep list (Phase 2, in order)

**Signals + producers (additive):**
- `packages/sdk/src/registry.ts` — new `defineSignal` + `signalTree` entries.
- `packages/sdk/src/index.ts` — exports.
- `packages/forge-github/src/signals.ts` — producers; widen `GithubUser`/`PrFile`/
  `PrCommit` interfaces; new `loadPrDetails` (`GET /pulls/{n}`) and `loadIssueReactions`
  (`GET /issues/{n}`) wrappers.
- new shared pure module (sibling of `text-metrics.ts`) — emoji / code-ref / issue-ref
  fns + the rebuilt `COMMENT_PREFIXES_BY_LANGUAGE` map.
- `packages/forge-github/src/signals.test.ts` — call-count/dedupe tests: `pr-details`
  feeds body + maintainerCanModify in one call; `user` still one call after the
  profileCompleteness widening; `mergeRatioInRepo` adds zero calls.

**Verbs:**
- `containsAny` (text) and `anyIn` (textList): `packages/sdk/src/comparison.ts`,
  `evaluate.ts` (add cases in `compareText` and `compareTextList`),
  `stored-rule.ts` (`VERBS_FOR_KIND` text + textList arrays), `index.ts`.
- `packages/contracts/src/custom-rules-display.ts` — `VERBS_BY_KIND` text + textList,
  sentence labels.

**Picker:**
- `apps/web/src/components/rules/custom-rule-builder.tsx` — `BuilderState.area`, area
  chip, filtered signal list, moved cascade, group-order array.
- `packages/contracts/src/custom-rules-display.ts` — add two group labels to the
  union, new `CUSTOM_SIGNALS` entries, relocate `pr.title` + commit signals.

**Guards to update (no behaviour change):**
- `packages/core/src/rules/catalog-sync.test.ts`, SDK registry exhaustiveness/count
  tests, `packages/contracts/src/custom-rules-display.test.ts`.

### A1. Emoji patterns (over `title + " " + body`)

```
unicode:   /\p{Extended_Pictographic}/gu
shortcode: /(?<!\w):[\w+-]+:(?!\w)/g
count = unicodeMatches.length + shortcodeMatches.length
```

### A2. Inline code-reference patterns (over body only, summed independently)

```
1. /(?:[\w@.-]+\/)+[\w.-]+\.\w{1,10}/g     // file paths: foo/bar/baz.ts
2. /\w+(?:->|::)\w+\(\)/g                   // method calls: Foo::bar(), $x->y()
3. /\w{3,}\(\)/g                            // function calls: fooBar()
```
Only empty-paren calls match; a token satisfying more than one pattern double-counts.

### A3. Issue-reference patterns (over body only, numbers into a Set, capture group 1)

```
1. /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/gi   // full issue URL
2. /(?:[\w.-]+\/[\w.-]+)#(\d+)/g                                 // owner/repo#123
3. /GH-(\d+)/gi                                                  // GH-123
4. /(?:^|[\s(])#(\d+)/gm                                         // bare #123
```
Only the number is captured; cross-repo refs collapse to a bare number. `/issues/`
URLs only (PR URLs not matched).

### A4. Conventional-commit pattern (title and commit subjects)

```
CONVENTIONAL_PATTERN = /^(\w+)(?:\([^)]+\))?!?:\s.+/
```
Type is any `\w+` (not restricted). For commits, exclude subjects starting `Merge ` and
matching squash suffix `/\(#\d+\)$/` before testing.

### A5. Spam-username patterns (reference only — we ship raw `login`, not this)

```
/^\d+$/          // all digits
/\d{2,}/         // >=2 consecutive digits
/(?:^|-)ai(?:-|$)/i   // an "ai" segment delimited by start/end/hyphen
```

### A6. Merge-ratio search queries

`client.rest.search.issuesAndPullRequests({ q, per_page: 1 })`, read `total_count`.

```
global merged:          is:pr is:merged author:<user>
global closed-unmerged: is:pr is:unmerged is:closed author:<user>
repo   merged:          is:pr is:merged author:<user> repo:<owner>/<repo>
repo   closed-unmerged: is:pr is:unmerged is:closed author:<user> repo:<owner>/<repo>
```
Optional exclude-own appends ` -user:<user>` to the global queries. Ratio =
merged/(merged+closed); skip (not applicable) when the denominator is 0.

### A7. Profile-completeness fields (10, one point each; `>= min` passes)

```
name              !!name
company           !!company
blog              !!blog
location          !!location
email             !!email
hireable          hireable !== null      // false still counts as present
bio               !!bio
twitter           !!twitter_username
followers         followers > 0
following         following > 0
```

### A8. COMMENT_PREFIXES_BY_LANGUAGE (extension → prefixes; rebuild from these facts)

Match = a comment prefix is a prefix of the trimmed added line. Block-comment
continuation lines starting `*` or `-->` are NOT counted (the opener counts once).

| Extensions | Prefixes |
|---|---|
| c, cjs, cpp, cs, css, dart, go, h, hpp, java, js, jsx, kt, less, mjs, php, proto, rs, scala, scss, swift, ts, tsx, zig | `//`, `/*`, `*`, `{/*` |
| bash, cmake, coffee, cr, ex, jl, nim, pl, ps1, py, r, rb, sh, tf, toml, yaml, yml, zsh | `#` |
| ada, elm, hs, lua, sql, vhdl | `--` |
| htm, html, svg, xml | `<!--`, `-->` |
| astro, svelte, vue | `//`, `/*`, `*`, `{/*`, `<!--`, `-->` |
| asm, clj, cljs, el, ini, lisp, rkt, scm | `;` |
| erl, pro, sty, tex | `%` |
| f, f90, f95, for | `!` |

Block-comment continuation prefixes (skip, don't count): `*`, `-->`.
`ext` = lowercased segment after the last `.` in the filename (`file.tar.gz` → `gz`).
