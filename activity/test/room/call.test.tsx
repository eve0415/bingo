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

  it('says what the reserved row will hold, on the screen that does the drawing', (): void => {
    const html = renderToString(<CalledNumber history={[]} idle="最初の番号を引くと、ここに履歴が並びます" latest={null} progress="0 / 75" />);
    expect(html).toContain('<span data-bingo-history-idle="">最初の番号を引くと、ここに履歴が並びます</span>');

    // The strip holds what came before the call, so one draw leaves it empty. The sentence still has to go.
    const first = renderToString(
      <CalledNumber history={[]} idle="最初の番号を引くと、ここに履歴が並びます" latest={{ value: 5, letter: 'B' }} progress="1 / 75" />,
    );
    expect(first).not.toContain('data-bingo-history-idle');

    const drawn = renderToString(
      <CalledNumber
        history={[{ value: 5, letter: 'B' }]}
        idle="最初の番号を引くと、ここに履歴が並びます"
        latest={{ value: 16, letter: 'I' }}
        progress="2 / 75"
      />,
    );
    expect(drawn).not.toContain('data-bingo-history-idle');
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
    expect(html).toContain('aria-atomic="true" aria-live="polite" data-bingo-call-value=""');
    expect(html).toContain('<span data-bingo-letter="">I</span>');
    expect(html).toContain('<span data-bingo-call-result="">20</span>');
    expect(html).toContain('aria-label="呼ばれた番号"');
    expect(html.match(/data-bingo-history-item=""/gu)).toHaveLength(2);
  });

  it('keeps the last few calls inside the box where there is no room for a strip under it', (): void => {
    const html = renderToString(
      <CalledNumber
        latest={{ value: 20, letter: 'I' }}
        progress="3 / 75"
        recent={[
          { value: 16, letter: 'I' },
          { value: 5, letter: 'B' },
        ]}
        variant="compact"
      />,
    );
    expect(html).toContain('<div aria-label="呼ばれた番号" data-bingo-recent="" role="group">');
    expect(html).toContain('<span data-bingo-recent-item="">16</span>');
    expect(html).toContain('<span data-bingo-recent-item="">5</span>');
    expect(html).not.toContain('data-bingo-history');
  });

  it('drops the letter on a board that has none', (): void => {
    const html = renderToString(<CalledNumber history={[{ value: 9, letter: null }]} latest={{ value: 30, letter: null }} progress="2 / 45" variant="hero" />);
    expect(html).not.toContain('data-bingo-letter');
    expect(html).toContain('<span data-bingo-call-result="">30</span>');
    expect(html).toContain('<span data-bingo-num="">9</span>');
  });
});
