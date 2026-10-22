import {describe, expect, test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {SLOW_NOTICE, SlowNotice} from '#/components/glaze/ui/slow-notice.tsx';

describe('SlowNotice', () => {
  test('holds an empty status region until the wait turns slow', () => {
    const html = renderToStaticMarkup(<SlowNotice active/>);
    expect(html).toContain('role="status"');
    expect(html).not.toContain(SLOW_NOTICE);
  });

  test('the message is one plain sentence', () => {
    expect(SLOW_NOTICE).toBe('This is taking abnormally long to process.');
  });
});
