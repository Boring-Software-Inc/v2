# avatar

2026-07-22, transformation engine, direct mapping, migrated clean.

## Changed

- apps/web/src/components/ui/avatar.tsx: @radix-ui/react-avatar ->
  @base-ui/react/avatar (Root/Image/Fallback, same anatomy). Types moved to
  AvatarPrimitive.<Part>.Props. crossOrigin retained on Image. Classes
  unchanged. Leftover scan clean.

## Left alone

- Both consumers use Avatar/AvatarImage/AvatarFallback plainly; no changes.

## Behavior changes

- Base UI's Image load detection is its own implementation; the fallback
  should appear for broken URLs exactly as before. Flagged for the manual
  check only.

## Verify by hand

- Topbar user avatar renders; with the network image blocked the fallback
  initials render.
