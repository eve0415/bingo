import type { JSX } from 'react';

import { flashboard } from './model';

/**
 * The printed board a caller crosses off: one row per column range, every number in its own place.
 * Whoever is calling reads it to know what is left, and whoever is watching reads it for the same reason, so it belongs to neither screen.
 */
export const Flashboard = ({ drawnOrder, size }: { drawnOrder: readonly number[]; size: number }): JSX.Element => (
  <div data-bingo-flash="" data-lettered={size === 5}>
    {flashboard(drawnOrder, size).map(row => (
      <div data-bingo-flash-row="" key={row.letter ?? row.cells[0].value}>
        <div aria-hidden="true" data-bingo-flash-letter="">
          {row.letter}
        </div>
        {row.cells.map(cell => (
          <div
            aria-label={`${cell.value} ${cell.called ? '呼ばれた' : 'まだ'}`}
            data-bingo-flash-cell=""
            data-called={cell.called}
            data-live={cell.live}
            key={cell.value}
            role="img"
          >
            {cell.value}
          </div>
        ))}
      </div>
    ))}
  </div>
);
