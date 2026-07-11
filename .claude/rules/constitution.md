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
| The verdict | "blocked", "passed", "sent to review" | "rejected", "denied", "failed" (people fail; PRs get blocked) |
| The subject | "contributor", "change request" | "user" (users are maintainers), "PR" in agnostic contexts |
| AI-generated junk | "slop" | euphemisms |
| Comment/issue checks | "rules" (they're rules with a content target) | "automod", "filters", "AI moderation" |
| Reversible content action | "hide", "hidden" (unhide to reverse) | "delete", "remove" (deletion is a human verb in moderation) |
| Tone | terse, lowercase-friendly, zero exclamation marks | marketing superlatives |

Applies to UI strings, empty states, error copy, the PR comment, docs, and
commit/PR descriptions written in Grim's voice.
