'use client';

import {useEffect, useRef, useState} from 'react';
import {Icon, Check, Copy, Warning} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';
import {Button, type ButtonProps} from '#/components/glaze/ui/button.tsx';

// Glaze's copy button: a Button that copies a value and confirms in place. Ghost and icon-only by default, so it sits
// quietly at the end of a row, a code block or a field; secondary (flat) where it is the card's own action.
//
// The glyph cuts from Copy to Check for 1.6s and a hidden status region says "Copied", so a screen reader hears it
// too. With a visible label, "Copy", "Copied" and "Failed" share one grid cell, so the pill never changes width. If the
// clipboard is refused it shows the warning glyph and says how to copy by hand. A value fetched on demand (a function
// that returns a promise, such as a key read from a vault) pends in place with Button's arc, and a second press while
// it fetches does nothing.
//
// WebKit drops the press's user activation across an await, so for a fetched value the button calls clipboard.write
// in the same tick as the press, with a ClipboardItem whose text is a promise; the browser holds the activation until
// it settles. Where that is missing or refused, it awaits the value and falls back to writeText.

type CopyState = 'idle' | 'fetching' | 'copied' | 'failed';

/** Writes a value that is still being fetched, keeping the press's user activation. */
async function writeFetched(result: Promise<string>): Promise<string> {
  let text = '';
  const blob = result.then(t => { text = t; return new Blob([t], {type: 'text/plain'}); });
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
    try {
      // Called before any await, so it runs inside the press.
      await navigator.clipboard.write([new ClipboardItem({'text/plain': blob})]);
      return text;
    } catch {
      // Falls through to writeText, which works wherever the activation survives the await.
    }
  }
  text = await result;
  await navigator.clipboard.writeText(text);
  return text;
}

type CopyButtonProps = Omit<ButtonProps, 'onClick' | 'onCopy' | 'children' | 'pending' | 'pendingLabel' | 'value'> & {
  /** The text to copy, or a function that returns it, for a value fetched on demand. */
  value: string | (() => string | Promise<string>);
  /** What is copied, for the accessible name: "run ID" gives "Copy run ID". */
  label?: string;
  /** Shows "Copy", then "Copied", as text after the glyph. */
  showLabel?: boolean;
  /** How long the confirmation stays, in ms. */
  timeout?: number;
  onCopy?: (value: string) => void;
  /** Shows one state without a press, for the docs. Presses still copy. */
  forceState?: Exclude<CopyState, 'idle'>;
};

function CopyButton({value, label, showLabel = false, timeout = 1600, onCopy, forceState, variant = 'ghost', size, className, ...props}: CopyButtonProps) {
  const [live, setState] = useState<CopyState>('idle');
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  useEffect(() => () => { clearTimeout(timer.current); cancelAnimationFrame(frame.current); }, []);
  const state = forceState ?? live;

  // Empty the region, then fill it on the next frame, so the same message twice is announced twice.
  const announce = (message: string) => {
    cancelAnimationFrame(frame.current);
    setAnnouncement('');
    frame.current = requestAnimationFrame(() => setAnnouncement(message));
  };

  const copy = async () => {
    clearTimeout(timer.current);
    try {
      let text: string;
      const result = typeof value === 'function' ? value() : value;
      if (typeof result === 'string') {
        text = result;
        await navigator.clipboard.writeText(text);
      } else {
        const writing = writeFetched(result);
        setState('fetching');
        text = await writing;
      }
      setState('copied');
      announce(label ? `${label} copied` : 'Copied');
      onCopy?.(text);
    } catch {
      setState('failed');
      announce('Could not copy. Select the text and copy it by hand.');
    }
    timer.current = setTimeout(() => { setState('idle'); setAnnouncement(''); }, timeout);
  };

  const s = size ?? (showLabel ? 'sm' : 'icon-sm');
  const glyph = state === 'copied' ? Check : state === 'failed' ? Warning : Copy;
  const iconSize = s === 'sm' ? 12 : s === 'lg' || s === 'icon-lg' ? 16 : 14;

  return <>
    <Button
      data-slot="copy-button"
      data-state={state}
      variant={variant}
      size={s}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      pending={state === 'fetching'}
      onClick={copy}
      className={className}
      {...props}
    >
      <Icon icon={glyph} size={iconSize}/>
      {showLabel && <span aria-hidden className="grid [grid-template-areas:'stack']">
        <span className={cn('[grid-area:stack]', state !== 'idle' && state !== 'fetching' && 'invisible')}>Copy</span>
        <span className={cn('[grid-area:stack]', state !== 'copied' && 'invisible')}>Copied</span>
        <span className={cn('[grid-area:stack]', state !== 'failed' && 'invisible')}>Failed</span>
      </span>}
    </Button>
    <span role="status" data-slot="copy-button-status" className="sr-only">{announcement}</span>
  </>;
}

export {CopyButton, type CopyButtonProps};
