# Tripwire

Tripwire is a contribution gatekeeper. It checks each change request against
the repo's rules and workflows and decides what happens next.

## Language

### Verdicts

**Passed**:
The change request meets every enforcing requirement.
_Avoid_: approved, accepted

**Blocked**:
The Tripwire check fails and Tripwire requests changes. The change request stays open.
_Avoid_: rejected, denied, failed

**Changes needed**:
The Tripwire check fails and the author gets an instruction. No GitHub review.
_Avoid_: changes requested, fix required, rejected

**Human review**:
A maintainer approves or blocks the change request in Tripwire.
_Avoid_: sent to review, moderation

**Closed**:
Tripwire posted the reason, failed the check and closed the change request. Tripwire never reopens it.
_Avoid_: rejected, deleted

### Rules and workflows

**Rule**:
One boolean requirement that every non-exempt contributor must meet.
_Avoid_: filter, check (in product copy)

**Installed rule**:
A rule that runs on its own. It blocks when it does not pass.
_Avoid_: enabled, on

**Outcome**:
What a workflow does when its check does not pass: Block, Ask author to fix, Human review, Note only or Close.
_Avoid_: severity, fixable rule

**Note**:
A plain fact added to the comment on a green check.
_Avoid_: warning

**Skip when**:
A gate before a rule group. When its checks match, the group is skipped and the run shows it as skipped, never as passed. Missing proof never skips a group. In code: `unless(group, skipWhen)`.
_Avoid_: except when, exception, allow, allowlist, bypass, override

**Workflow**:
The logic that composes rules, gates and actions. The implicit Rules workflow blocks on every installed rule.
_Avoid_: pipeline, automation
