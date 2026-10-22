export const SLOW_VARIANT_COOKIE = 'tw-slow-variant';

const BUTTON_VARIANTS = {A: 'tooltip', B: 'label', C: 'toast'} as const;
const REGION_VARIANTS = {D: 'inside', E: 'toast'} as const;

export type SlowButtonVariant = (typeof BUTTON_VARIANTS)[keyof typeof BUTTON_VARIANTS];
export type SlowRegionVariant = (typeof REGION_VARIANTS)[keyof typeof REGION_VARIANTS];

export const DEFAULT_SLOW_BUTTON_VARIANT: SlowButtonVariant = 'tooltip';
export const DEFAULT_SLOW_REGION_VARIANT: SlowRegionVariant = 'inside';

export function parseSlowVariant(cookie: string) {
  const choice = cookie.match(new RegExp(`(?:^|;\\s*)${SLOW_VARIANT_COOKIE}=([A-Ea-e]+)`))?.[1]?.toUpperCase() ?? '';
  const button = (['A', 'B', 'C'] as const).find(key => choice.includes(key));
  const region = (['D', 'E'] as const).find(key => choice.includes(key));
  return {
    button: button ? BUTTON_VARIANTS[button] : DEFAULT_SLOW_BUTTON_VARIANT,
    region: region ? REGION_VARIANTS[region] : DEFAULT_SLOW_REGION_VARIANT,
  };
}

export function slowVariant() {
  return parseSlowVariant(import.meta.env.DEV ? globalThis.document?.cookie ?? '' : '');
}
