---
description: Language & positioning rules for all user-facing copy — the use/never-use table so UI and marketing wording never drifts. Load when writing any copy a human reads.
paths:
  - "apps/web/**"
  - "**/*.mdx"
  - "README.md"
---

# Constitution — language for user-facing copy (§12)

A use/never table so copy never drifts. Grim expands this over time; append,
don't rewrite.

| Concept | Use | Never |
|---|---|---|
| The product | "contribution gatekeeper", "firewall for your repo" | "AI code review tool", "bot", "linter" |
| The verdict | "blocked", "passed", "human review" | "rejected", "denied", "failed", "sent to review" (people fail; PRs get blocked) |
| Blocked, defined | "Fails the Tripwire check and requests changes. The change request stays open." | "blocks the merge", "closes" (only branch protection holds a merge) |
| The human review decision | "Approve", "Block" | "Reject", "Deny" |
| Asking GitHub reviewers | "Request GitHub review" | "Request review" (collides with human review) |
| The subject | "contributor", "change request" | "user" (users are maintainers), "PR" in agnostic contexts |
| AI-generated junk | "slop" | euphemisms |
| Comment/issue checks | "rules" (they're rules with a content target) | "automod", "filters", "AI moderation" |
| Reversible content action | "hide", "hidden" (unhide to reverse) | "delete", "remove" (deletion is a human verb in moderation) |
| Tone | terse, lowercase-friendly, zero exclamation marks | marketing superlatives |
| A fix request, as a verdict | "Changes needed" | "changes requested" (GitHub's review state, which only Block submits), "fix required", "rejected" |
| Changes needed, defined | "Fails the Tripwire check and tells the author what to change. No GitHub review." | "blocks", "requests changes" |
| What happens when a rule does not pass | "Block", "Ask author to fix", "Human review", "Note only", "Close" | "severity", "fixable rule" (fixable is an outcome choice, not a rule class) |
| A scoped exception | "Skip when" (a gate before a rule group; `unless(group, skipWhen)` in code) | "Except when", "Exception", "Allow", "allowlist", "whitelist", "bypass", "override" |

Applies to UI strings, empty states, error copy, the PR comment, docs, and
commit/PR descriptions written in Grim's voice.
