import type { CardCellView } from '../../app/room/lines';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BingoCard } from '../../app/room/card';

import { clickEveryAction } from './fixture';

const cell = (number: number, state: CardCellView['state'], free = false): CardCellView => ({
  number,
  free,
  state,
});

const CELLS = [cell(1, 'open'), cell(2, 'reach'), cell(3, 'marked'), cell(4, 'winning'), cell(5, 'pending'), cell(0, 'marked', true)];

describe('the bingo card', () => {
  it('reads as numbers rather than controls when this player may not change it', (): void => {
    const html = renderToString(<BingoCard cells={CELLS} size={5} />);
    expect(html).toContain('data-flat="false"');
    expect(html).toContain('data-size="5"');
    expect(html).toContain('style="max-width:var(--card-max)"');
    expect(html).toContain('aria-label="5×5 ビンゴカード"');
    expect(html).toContain('<div>B</div>');
    expect(html).toContain('<div>O</div>');
    expect(html).toContain('aria-label="1 未マーク"');
    expect(html).toContain('aria-label="2 リーチ"');
    expect(html).toContain('aria-label="3 マーク済み"');
    expect(html).toContain('aria-label="4 ビンゴ"');
    expect(html).toContain('aria-label="5 送信中"');
    expect(html).toContain('aria-label="FREE マーク済み"');
    expect(html).toContain('role="img"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-bingo-strike');
  });

  it('blots a cell only once the room has taken it', (): void => {
    const html = renderToString(<BingoCard cells={CELLS} size={5} />);
    expect(html.match(/data-bingo-blot=""/gu)).toHaveLength(4);
    expect(html).toContain('rotate(-3deg)');
  });

  it('strikes a completed row, column and both diagonals through the wider unlettered card', (): void => {
    const html = renderToString(
      <BingoCard
        cells={CELLS}
        flat
        lines={[
          { kind: 'row', index: 1 },
          { kind: 'col', index: 2 },
          { kind: 'diag', index: 0 },
          { kind: 'diag', index: 1 },
        ]}
        maxWidth="320px"
        size={7}
      />,
    );
    expect(html).toContain('data-flat="true"');
    expect(html).toContain('style="max-width:320px"');
    expect(html).not.toContain('data-bingo-letters');
    expect(html).toContain('top:21.428571428571427%');
    expect(html).toContain('left:35.714285714285715%');
    expect(html).toContain('rotate(45deg)');
    expect(html).toContain('rotate(-45deg)');
    expect(html.match(/data-bingo-strike=""/gu)).toHaveLength(4);
  });

  it('becomes a control on every cell this player may still change, and never on the free centre', (): void => {
    const tapped: number[] = [];
    const card = (
      <BingoCard
        cells={CELLS}
        onTap={(index): void => {
          tapped.push(index);
        }}
        size={5}
      />
    );
    const html = renderToString(card);
    expect(html).toContain('aria-label="1 未マーク" aria-pressed="false"');
    expect(html).toContain('aria-label="3 マーク済み" aria-pressed="true"');
    expect(html).toContain('aria-label="4 ビンゴ" aria-pressed="true"');
    expect(html).toContain('type="button"');
    expect(html).toContain('<span aria-label="FREE マーク済み" data-bingo-cell="" data-free="true" data-state="marked" role="img">');
    expect(html).not.toContain('aria-label="FREE マーク済み" aria-pressed');

    clickEveryAction(card);
    expect(tapped).toEqual([0, 1, 2, 3, 4]);
  });
});
