import type { CardCellView, CellState, StrikeLine } from './lines';
import type { CSSProperties, JSX } from 'react';

import { LETTERS } from './lines';

/** The blot is ink on paper, so no two land at the same angle. */
const ROTATIONS = [-8, 6, -3, 10, -12, 4, 8, -6, 2, -10, 5];

const STATE_LABEL = {
  open: '未マーク',
  pending: '送信中',
  marked: 'マーク済み',
  reach: 'リーチ',
  winning: 'ビンゴ',
} as const satisfies Record<CellState, string>;

const FREE = 'FREE';

const cellLabel = (cell: CardCellView): string => `${cell.free ? FREE : cell.number} ${STATE_LABEL[cell.state]}`;

const blot = (index: number): JSX.Element => (
  <span
    aria-hidden="true"
    data-bingo-blot=""
    style={{
      transform: `rotate(${ROTATIONS[index % ROTATIONS.length]}deg)`,
    }}
  />
);

const contents = (cell: CardCellView, index: number): JSX.Element => (
  <>
    {cell.state === 'open' || cell.state === 'reach' ? null : blot(index)}
    <span data-bingo-num="">{cell.free ? FREE : cell.number}</span>
  </>
);

/** A cell is a control only while this player may actually change it; anywhere else it is a number to read, never a dimmed button. */
const Cell = ({ cell, index, onTap }: { cell: CardCellView; index: number; onTap?: (index: number) => void }): JSX.Element =>
  onTap === undefined ? (
    <span aria-label={cellLabel(cell)} data-bingo-cell="" data-free={cell.free} data-live={cell.live} data-state={cell.state} role="img">
      {contents(cell, index)}
    </span>
  ) : (
    <button
      aria-label={cellLabel(cell)}
      aria-pressed={cell.state === 'marked' || cell.state === 'winning'}
      data-bingo-cell=""
      data-free={cell.free}
      data-live={cell.live}
      data-state={cell.state}
      onClick={() => {
        onTap(index);
      }}
      type="button"
    >
      {contents(cell, index)}
    </button>
  );

const centre = (position: number, size: number): string => `${((position + 0.5) / size) * 100}%`;

const strikeStyle = (line: StrikeLine, size: number): CSSProperties => {
  if (line.kind === 'row') {
    return {
      left: '2%',
      right: '2%',
      height: 'var(--stroke-strike)',
      top: centre(line.index, size),
      transform: 'translateY(-50%)',
    };
  }
  if (line.kind === 'col') {
    return {
      top: '2%',
      bottom: '2%',
      width: 'var(--stroke-strike)',
      left: centre(line.index, size),
      transform: 'translateX(-50%)',
    };
  }
  return {
    left: '50%',
    top: '50%',
    width: '134%',
    height: 'var(--stroke-strike)',
    transform: `translate(-50%,-50%) rotate(${line.index === 0 ? 45 : -45}deg)`,
  };
};

/**
 * The card is the object people already know: a fixed grid, a free centre, numbers where they belong.
 * Nothing here reinterprets it, and the strike bar through a completed line is the whole celebration.
 */
export const BingoCard = ({
  cells,
  size,
  lines = [],
  maxWidth = 'var(--card-max)',
  flat = false,
  settled = false,
  onTap,
}: {
  cells: readonly CardCellView[];
  size: number;
  lines?: readonly StrikeLine[];
  maxWidth?: string;
  flat?: boolean;
  /** A card the game has finished with is a record rather than a live card, so nothing on it is still being waited for. */
  settled?: boolean;
  onTap?: (index: number) => void;
}): JSX.Element => (
  <div
    data-bingo-card=""
    data-flat={flat}
    data-live={cells.some(cell => cell.live)}
    data-settled={settled}
    data-size={size}
    style={{
      maxWidth,
    }}
  >
    {size === LETTERS.length ? (
      <div aria-hidden="true" data-bingo-letters="">
        {LETTERS.map(letter => (
          <div key={letter}>{letter}</div>
        ))}
      </div>
    ) : null}
    <div aria-label={`${size}×${size} ビンゴカード`} data-bingo-grid="" role="group">
      {cells.map((cell, index) => (
        <Cell cell={cell} index={index} key={index} onTap={cell.free ? undefined : onTap} />
      ))}
      {lines.map((line, index) => (
        <div aria-hidden="true" data-bingo-strike="" key={index} style={strikeStyle(line, size)} />
      ))}
    </div>
  </div>
);
