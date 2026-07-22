# badge

2026-07-22, transformation engine, migrated clean.

## Changed

- apps/web/src/components/ui/badge.tsx: the manual Slot idiom
  (const Comp = asChild ? Slot : "span") replaced with useRender from
  @base-ui/react/use-render, per the skill's non-button polymorphic rule.
  Props are useRender.ComponentProps<"span"> + the cva variants; asChild is
  gone, render is the polymorphic hook. All variant classes unchanged.
- Leftover scan clean: no radix imports remain in badge.tsx.

## Left alone

- Both consumers (org-members-page, github-comment-mock) use Badge as a
  plain span; no asChild call sites existed, so no consumer changes.

## Behavior changes

None. Default rendering is the same span with the same classes.

## Verify by hand

- Org members page: role badges render and truncate as before.
- Customize page: the mock GitHub comment badges render.
