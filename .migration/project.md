# project: radix -> base ui, whole-project

2026-07-22, transformation-engine mode (no components.json; hand-rolled
wrappers in apps/web/src/components/ui). 8 wrappers, 7 radix packages.

## Dependency swap

- Installed @base-ui/react@1.6.0; removed @radix-ui/react-avatar, -dialog,
  -dropdown-menu, -separator, -slot, -switch, -tooltip from apps/web.
  package.json has zero radix deps. bun.lock keeps 17 transitive @radix-ui
  entries owned by cmdk (third-party, out of scope by hard rule).

## App-code sweep

- asChild is gone from the app: 8 Button sites -> render + nativeButton
  ={false}; 4 menu sites -> render / flattened trigger. grep for asChild,
  @radix-ui, radix-ui across apps/web/src: zero code hits (one explanatory
  comment in dropdown-menu.tsx mentions radix by name).

## Final build

- Baseline before migration: tsc 0 errors, biome clean, 157 web tests.
- After: tsc 0 errors, biome clean, 157/157 tests, production build
  (vite/nitro) succeeds.
- 0 wrappers remain on Radix.
