# rule ideas

a parking place for rules tripwire does not have yet. nothing here is built.
nothing here is scheduled. the point is that the idea stops living in one
person's head.

each entry says what it would enforce and why it is hard.

---

## 1. required media for a tagged change

**the idea:** a change request tagged as a user-interface change must include
proof that it works. a screenshot at least. a video for a flow.

if the tag says `feat(ui)` and the body has no image, block it.

**generalised:** a tag requires a kind of evidence.

| tag | required proof |
| --- | --- |
| a ui change | a before image and an after image |
| a flow or animation | a video |
| a performance fix | a before and after measurement |
| a migration | the plan, and the way back |

**why it is worth doing:** this is a rule every team writes into a document
and no team enforces. the reviewer either asks for the screenshot, or gives up
and approves. a machine can ask, every time, without getting tired.

**why it is hard:**

- reading a tag is easy. deciding whether an image is a BEFORE image is not.
- a contributor can attach any image and pass. the rule proves an image
  exists, not that it is honest.
- an image lives in the body as a link. the rule must tell an uploaded image
  from a linked badge.
- the tag itself is unreliable. a contributor who forgets the tag skips the
  rule entirely, so the rule may need to read the diff to know a ui file
  changed.

the last point is the real design question: trust the tag, or read the change
and decide for itself.

---

## 2. commit message standard

**the idea:** tripwire enforces a commit convention on the change request, the
way commitlint does on a local machine.

a repository sets its shape once. every commit in every change request is
checked against it.

**why it is worth doing:** a local hook only protects the people who installed
it. an outside contributor has no hook. so the convention holds inside the team
and breaks at the edge, which is exactly where the history gets messy.

a forge-side check has no such gap. it also means a repository can adopt a
convention without asking anyone to install anything.

**why it is hard:**

- a rule that fails on the last commit of a large branch is infuriating. it
  needs to say which commit, and what to write instead.
- squash-merging makes most of it moot. the rule should probably check the
  change request TITLE when the repository squashes, and the commits when it
  does not.
- every team wants a slightly different shape, so the shape has to be
  configuration, not code.

---

## 3. a suite of code-quality rules

**the idea:** the two above are examples of one larger thing — a set of rules a
repository can turn on to enforce the standards it already wrote down.

candidates:

- a change request must link an issue
- a change request over a size limit must be split
- a new dependency must be declared, not slipped in
- a test file must accompany a change to its source file
- a migration must not arrive with unrelated changes

**why it is worth doing:** every one of these lives in a contributing guide
somewhere, unenforced. the guide is where standards go to be ignored.

**why it is hard:** each is easy alone and annoying together. a repository that
turns on all five will block almost everything, and the maintainer will turn
the lot off. this needs care about defaults and about how a rule explains
itself, more than it needs rule code.

---

## next step

none of this is a plan. if any of it gets built, the first question is the same
for all three: does the rule read the change itself, or does it trust what the
contributor labelled it?

trusting the label is easy and gameable. reading the change is honest and
harder.
