import type * as React from 'react';
import {clsx, type ClassValue} from 'clsx';
import {extendTailwindMerge} from 'tailwind-merge';

// Glaze's own utilities, registered so tailwind-merge resolves conflicts between them: a later type-* role replaces
// an earlier one, a later glass key replaces an earlier one, and text-text-2 replaces text-text-1.
const twMerge = extendTailwindMerge<'type-role' | 'glass-key'>({
  extend: {
    classGroups: {
      'type-role': [{type: ['title', 'heading', 'heading-sm', 'body', 'body-sm', 'label', 'label-sm', 'label-lg', 'caption', 'code', 'code-sm', 'code-xs']}],
      'glass-key': [{glass: ['ink', 'paper', 'coral']}],
    },
  },
});

/**
 * The height of a one-line control, one formula for every control of that size: the size's token, or one line plus
 * 8px of padding if the text grows past it (200% text zoom), so the label never spills out of the box.
 */
export const controlHeight = {
  sm: 'h-[max(var(--control-sm),calc(1lh+var(--space-2)))]',
  default: 'h-[max(var(--control),calc(1lh+var(--space-2)))]',
  lg: 'h-[max(var(--control-lg),calc(1lh+var(--space-2)))]',
} as const;

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Glaze's classes and the caller's, for a Base UI part whose className may be a function of its state (data-checked,
 * open, disabled ...). A function is composed, not passed through, so Glaze's classes stay either way.
 */
export function mergeClass<State>(base: ClassValue, className: string | ((state: State) => string | undefined) | undefined): string | ((state: State) => string) {
  return typeof className === 'function' ? (state: State) => cn(base, className(state)) : cn(base, className);
}

/**
 * One callback ref that sets every ref it is given, for a component that keeps its own ref and forwards the caller's.
 * Wrap it in useMemo or useCallback when the element should not be detached and attached again on every render.
 */
export function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return node => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<T | null>).current = node;
    }
  };
}
