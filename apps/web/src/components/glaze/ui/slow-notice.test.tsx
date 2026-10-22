import {describe, expect, test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {SLOW_NOTICE, SlowNotice, SlowRegion} from '#/components/glaze/ui/slow-notice.tsx';
import {Skeleton} from '#/components/glaze/ui/skeleton.tsx';
import {Button} from '#/components/glaze/ui/button.tsx';

describe('SlowNotice', () => {
  test('renders nothing until the wait turns slow', () => {
    expect(renderToStaticMarkup(<SlowNotice active/>)).toBe('');
  });

  test('a region of skeleton bars renders only its bars before the wait turns slow', () => {
    const html = renderToStaticMarkup(<SlowRegion>{Array.from({length: 12}, (_, i) => <Skeleton key={i}/>)}</SlowRegion>);
    expect(html.match(/data-slot="skeleton"/g)?.length).toBe(12);
    expect(html).not.toContain(SLOW_NOTICE);
  });

  test('a pending button keeps its own markup until the wait turns slow', () => {
    const html = renderToStaticMarkup(<Button pending>Save</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(SLOW_NOTICE);
  });

  test('the message is one plain sentence', () => {
    expect(SLOW_NOTICE).toBe('This is taking abnormally long to process.');
  });
});
