# separator

2026-07-22, transformation engine, direct mapping (callable), migrated clean.

## Changed

- apps/web/src/components/ui/separator.tsx: @radix-ui/react-separator ->
  @base-ui/react/separator. The primitive is callable (no .Root). The radix
  `decorative` prop is dropped per the mapping (Base UI separators carry
  role="separator" semantics themselves). orientation + all classes
  unchanged. Leftover scan clean.

## Left alone

- No app consumers import the separator wrapper today; wrapper-only change.

## Behavior changes

- `decorative` no longer exists; the element now always exposes separator
  semantics. No consumer relied on it.

## Verify by hand

- None (unused wrapper); render one in isolation if desired.
