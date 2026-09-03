import type { JSX } from 'react';

export type PlayerStatus = 'waiting' | 'playing' | 'reach' | 'bingo' | 'host';

/** Every status carries a shape as well as a colour, so the roster reads in greyscale and for colour-blind players. */
const STATUS = {
  waiting: {
    glyph: '◇',
    label: '待機中',
  },
  playing: {
    glyph: '●',
    label: 'プレイ中',
  },
  reach: {
    glyph: '◆',
    label: 'リーチ',
  },
  bingo: {
    glyph: '★',
    label: 'ビンゴ',
  },
  host: {
    glyph: '▲',
    label: 'ホスト',
  },
} as const satisfies Record<PlayerStatus, { glyph: string; label: string }>;

export const StatusChip = ({
  status,
  size = 'md',
  surface = 'ground',
}: {
  status: PlayerStatus;
  size?: 'sm' | 'md';
  surface?: 'ground' | 'paper';
}): JSX.Element => (
  <span data-bingo-chip="" data-size={size} data-status={status} data-surface={surface}>
    <span aria-hidden="true" data-bingo-glyph="">
      {STATUS[status].glyph}
    </span>
    <span>{STATUS[status].label}</span>
  </span>
);
