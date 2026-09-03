import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalledNumber } from '../../app/room/call';

describe('the called number', () => {
  it('reserves its box before the first draw', (): void => {
    const html = renderToString(<CalledNumber latest={null} progress="—" />);
    expect(html).toContain('data-variant="hero"');
    expect(html).toContain('<span data-bingo-call-label="">いまの番号</span>');
    expect(html).toContain('<span data-bingo-call-progress="">—</span>');
    expect(html).toContain(
      '<div aria-atomic="true" aria-live="polite" data-bingo-call-value=""><span data-bingo-call-swap=""><span data-bingo-num="">—</span></span></div>',
    );
    expect(html).not.toContain('data-bingo-history');
  });

  it('reserves the history row from the first draw, before there is any history to put in it', (): void => {
    const html = renderToString(<CalledNumber history={[]} latest={{ value: 5, letter: 'B' }} progress="1 / 75" />);
    expect(html).toContain('<div aria-label="呼ばれた番号" data-bingo-history="" role="group" tabindex="0"></div>');
  });

  it('letters the call and keeps the earlier ones behind it', (): void => {
    const html = renderToString(
      <CalledNumber
        history={[
          { value: 5, letter: 'B' },
          { value: 16, letter: 'I' },
        ]}
        latest={{ value: 20, letter: 'I' }}
        progress="3 / 75"
        variant="compact"
      />,
    );
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain(
      '<div aria-atomic="true" aria-live="polite" data-bingo-call-value=""><span data-bingo-call-swap=""><span data-bingo-letter="">I</span><span data-bingo-num="">20</span></span></div>',
    );
    expect(html).toContain('aria-label="呼ばれた番号"');
    expect(html.match(/data-bingo-history-item=""/gu)).toHaveLength(2);
  });

  it('drops the letter on a board that has none', (): void => {
    const html = renderToString(<CalledNumber history={[{ value: 9, letter: null }]} latest={{ value: 30, letter: null }} progress="2 / 45" variant="hero" />);
    expect(html).not.toContain('data-bingo-letter');
    expect(html).toContain('<span data-bingo-num="">30</span>');
    expect(html).toContain('<span data-bingo-num="">9</span>');
  });
});
