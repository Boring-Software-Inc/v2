import {describe, expect, test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {Button} from '#/components/glaze/ui/button.tsx';
import {SLOW_NOTICE, StillLabel} from '#/components/glaze/ui/slow-notice.tsx';

describe('slow notice', () => {
  test('a pending button shows its pending label until the wait turns slow', () => {
    const html = renderToStaticMarkup(<Button pending pendingLabel="Saving">Save changes</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Saving');
    expect(html).not.toContain('Still');
    expect(html).not.toContain(SLOW_NOTICE);
  });

  test('the slow label keeps the pending verb and lowercases only its first letter in css', () => {
    const html = renderToStaticMarkup(<StillLabel pendingLabel="Saving"/>);
    expect(html).toContain('Still <span class="inline-block first-letter:lowercase">Saving</span>');
  });

  test('a button with no pending label says it is still working', () => {
    expect(renderToStaticMarkup(<StillLabel pendingLabel={undefined}/>)).toContain('Still working');
  });

  test('the message is one plain sentence', () => {
    expect(SLOW_NOTICE).toBe('This is taking abnormally long to process.');
  });
});
