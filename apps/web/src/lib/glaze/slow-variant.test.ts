import {describe, expect, test} from 'bun:test';
import {DEFAULT_SLOW_BUTTON_VARIANT, DEFAULT_SLOW_REGION_VARIANT, parseSlowVariant} from '#/lib/glaze/slow-variant.ts';

describe('parseSlowVariant', () => {
  test('falls back to the defaults with no cookie', () => {
    expect(parseSlowVariant('')).toEqual({button: DEFAULT_SLOW_BUTTON_VARIANT, region: DEFAULT_SLOW_REGION_VARIANT});
  });

  test('reads one button letter and one region letter', () => {
    expect(parseSlowVariant('a=1; tw-slow-variant=BE')).toEqual({button: 'label', region: 'toast'});
    expect(parseSlowVariant('tw-slow-variant=cd')).toEqual({button: 'toast', region: 'inside'});
    expect(parseSlowVariant('tw-slow-variant=A')).toEqual({button: 'tooltip', region: DEFAULT_SLOW_REGION_VARIANT});
  });

  test('ignores other cookies that end in the same name', () => {
    expect(parseSlowVariant('not-tw-slow-variant=C')).toEqual({button: DEFAULT_SLOW_BUTTON_VARIANT, region: DEFAULT_SLOW_REGION_VARIANT});
  });
});
