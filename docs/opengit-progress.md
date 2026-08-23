# open-git progress

what open-git must add before tripwire works there as well as it works on
github. every item below is a real gap found while running tripwire against
open-git.com, not a guess.

last checked: 2026-08-23, against `docs/openapi.json` (14 paths).

---

## what works today

these parts are done. they need no change from open-git.

| capability | how |
| --- | --- |
| sign in | oauth2, through the genericOAuth plugin |
| install the bot | `/integrations/<owner>/<slug>/install` |
| mint a token | `POST /api/v1/app/installations/{id}/access_tokens` |
| receive events | signed webhooks, `x-hub-signature-256` |
| read an installation | `GET /api/v1/app/installations/{id}` returns owner and name |
| block a merge | `POST /api/v1/repos/{owner}/{repo}/commits/{sha}/checks` |
| comment | `POST /api/v1/repos/{owner}/{repo}/pulls/{number}/comments` |

tripwire posts one check named `tripwire` on each commit. the check is the
whole merge gate. open-git blocks a merge on checks and reads no reviews.

---

## 1. reads, the largest gap

tripwire has 9 built-in rules. only 1 of them runs on open-git.

the other 8 read a diff, a commit list, or a contributor profile. open-git's
v1 api serves none of the three. the rules do not fail. they decline, and the
change request goes to review.

### 1.1 the diff of a pull request

**add:** `GET /api/v1/repos/{owner}/{repo}/pulls/{number}/files`

for each file, return the path, the status, the added line count, the deleted
line count, and the patch text.

**this unblocks 4 rules:**

- `crypto-address` finds a wallet address in the change
- `honeypot` finds a change to a protected path
- `max-files-changed` counts the files
- `ai-review` reads the change and reasons about it

a diff route already exists at `/api/repos/{repoId}/pulls/{prId}/diff`. it is
not usable here. it authenticates with a browser session, it is keyed by an
internal uuid, and an installation token cannot reach it.

### 1.2 a contributor profile

**add:** `GET /api/v1/users/{username}`

return the account creation date, the bio text, the follower count, and the
public repository count.

**this unblocks 2 rules:**

- `account-age` refuses an account that is too new
- `profile-readme` looks for an empty or spam profile

`/api/viewer` exists but returns the caller only. a rule must read the
contributor, who is a different person.

### 1.3 the author of a pull request

**change:** add `author` to each entry from
`GET /api/v1/repos/{owner}/{repo}/pulls`

the list returns `body`, `head_sha`, `id`, `number`, `state`, `title` and
`url`. it names no author, so tripwire cannot count a person's pull requests.

**this unblocks 2 rules:**

- `min-merged-prs` counts merged work, to trust a known contributor
- `pr-rate-limit` counts recent pull requests, to catch a spray attack

`pr-rate-limit` also needs a creation time on each entry.

### 1.4 the commits of a pull request

**add:** `GET /api/v1/repos/{owner}/{repo}/pulls/{number}/commits`

return the sha, the message, the author, and the authored time.

no built-in rule needs this yet. a custom rule can, and github supplies it.

### 1.5 file contents

**add:** `GET /api/v1/repos/{owner}/{repo}/contents/{path}?ref=<sha>`

`ai-review` reads a file to understand a change. it degrades without one.

---

## 2. actions

### 2.1 edit a comment

**add:** `PATCH /api/v1/repos/{owner}/{repo}/pulls/{number}/comments/{id}`
**add:** `GET /api/v1/repos/{owner}/{repo}/pulls/{number}/comments`

the comment endpoint creates only. tripwire cannot find its own comment, and
it cannot edit one.

tripwire therefore comments only when a verdict changes. a change request that
stays blocked gets one comment, not one for each push. this avoids a wall of
identical comments, but it also means an old comment stays visible after the
verdict changes.

with an edit route, tripwire keeps one comment and rewrites it.

### 2.2 dismiss a review

**add:** a way to dismiss or resolve a review

tripwire can request changes. it cannot withdraw that request. a stale
"changes requested" review would stay on the change request forever.

tripwire does not file reviews on open-git for this reason. the check does the
gating instead.

### 2.3 labels

**add:** `POST /api/v1/repos/{owner}/{repo}/pulls/{number}/labels`

a workflow can add a label on github. that action does nothing on open-git.

### 2.4 request a reviewer

**add:** `POST /api/v1/repos/{owner}/{repo}/pulls/{number}/requested_reviewers`

a moderation workflow asks a human to look. it cannot do that here.

### 2.5 close a pull request

**add:** a way to close a pull request through the api

there is no close route. `PUT .../merge` merges, and the session route reads
only. a test harness cannot clean up after itself.

---

## 3. webhook payloads

### 3.1 branch names and the draft flag

**change:** add `base_ref`, `head_ref` and `draft` to the pull request payload

the payload carries `id`, `number`, `author`, `title`, `body` and `head_sha`.

tripwire records these three as absent rather than guessing. any custom rule
about a target branch or a draft change request skips.

### 3.2 repository names on installation events

**change:** send repository objects, not bare ids

`installation.created` and `installation.repos_changed` list repositories as
uuids only:

```json
{ "action": "repos_changed",
  "installation_id": "…",
  "repositories": ["e2cb113f-…", "99bde44f-…"] }
```

a uuid alone cannot build a repository row. tripwire calls
`GET /api/v1/app/installations/{id}` after each event to get the owner and the
name. this works, but it is one extra call for data the event could carry.

### 3.3 visibility of a repository

**change:** add `private` to each repository

nothing reports whether a repository is public. tripwire stores every
open-git repository as private. this is the safe direction, because a public
run page must not open for a repository nobody confirmed is public. it is also
wrong for every public repository.

### 3.4 an actor on installation events

**change:** add the person who installed or changed the installation

tripwire records who did what. an installation event names nobody.

---

## 4. api surface

### 4.1 list the installations of a bot

**add:** `GET /api/v1/app/installations`

a bot can read one installation by id. it cannot list its own. recovery after
a lost id needs a list.

---

## summary

| gap | blocks |
| --- | --- |
| diff of a pull request | 4 rules |
| contributor profile | 2 rules |
| author on the pulls list | 2 rules |
| commits of a pull request | custom rules |
| file contents | ai-review quality |
| edit a comment | one clean comment per change request |
| dismiss a review | review-based blocking |
| labels | the label action |
| request a reviewer | the moderation handoff |
| close a pull request | test cleanup |
| refs and draft flag | branch and draft rules |
| names on installation events | one extra api call for each event |
| repository visibility | public run pages |
| actor on installation events | the audit trail |
| list installations | recovery |

the first three rows are the important ones. they take tripwire from 1 working
rule to 9.
