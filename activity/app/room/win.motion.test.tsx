import type { RoomView } from '@bingo/wrapper/protocol';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HOST, ME, OTHER, PROFILES, card, view } from '../../test/room/fixture';

import styles from './room.css?raw';
import { Win } from './win';

const noop = (): void => undefined;

const finished = (wins: RoomView['wins']): string =>
  renderToString(
    <Win
      dense={false}
      host={false}
      notice={null}
      onSend={noop}
      players={3}
      profiles={PROFILES}
      view={{ ...view(), phase: 'Finished', players: [HOST, ME, OTHER], cards: [card(ME)], wins }}
    />,
  );

describe('the result animation', () => {
  it('gives every rank a row of its own to arrive on', () => {
    const html = finished([
      { winners: [ME], patterns: [[0, 1, 2, 3, 4]], atSeq: 12, rank: 1 },
      { winners: [HOST, OTHER], patterns: [[5, 6, 7, 8, 9]], atSeq: 14, rank: 2 },
    ]);
    expect(html.match(/data-bingo-winner=""/gu)).toHaveLength(2);
    expect(html).toContain('<span data-bingo-rank="">1<!-- -->位</span>');
    expect(html).toContain('<span data-bingo-rank="">2<!-- -->位</span>');
  });

  it('has no row to stagger when the game ended without a bingo', () => {
    const html = finished([]);
    expect(html).not.toContain('data-bingo-winner=""');
    expect(html).toContain('ビンゴは出ませんでした');
    // The bar is the result's heading either way, so it is what carries the reveal.
    expect(html).toContain('<span aria-hidden="true" data-bingo-result-bar=""></span>');
  });

  it('settles the winners cards, so nothing on the result screen is still being waited for', () => {
    const html = finished([{ winners: [ME], patterns: [[0, 1, 2, 3, 4]], atSeq: 12, rank: 1 }]);
    expect(html).toContain('data-settled="true"');
    expect(html).not.toContain('data-settled="false"');
    expect(styles).toMatch(/\[data-bingo-card\]\[data-settled='true'\] \[data-bingo-cell\]\[data-state='reach'\] \{\s*animation: none;\s*\}/u);
  });

  it('reuses the card strike reveal for the bar and steps the ranks inside the motion budget', () => {
    expect(styles).toMatch(/\[data-bingo-result-bar\] \{[^}]*animation: strike-in var\(--dur-slow\) var\(--ease-out\);/u);
    expect(styles).toMatch(/\[data-bingo-winner\] \{[^}]*animation: result-rise var\(--dur\) var\(--ease-out\) backwards;/u);
    expect(styles).toMatch(/\[data-bingo-winner\]:nth-child\(2\) \{\s*animation-delay: 60ms;\s*\}/u);
    expect(styles).toMatch(/\[data-bingo-winner\]:nth-child\(n \+ 3\) \{\s*animation-delay: 120ms;\s*\}/u);
    expect(styles).toMatch(
      /@keyframes result-rise \{\s*from \{\s*transform: translateY\(6px\);\s*opacity: 0;\s*\}\s*to \{\s*transform: none;\s*opacity: 1;\s*\}\s*\}/u,
    );
  });

  it('shows the whole result at once when reduced motion is requested', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-result-bar\],\s*\[data-bingo-winner\] \{\s*animation: none;/u);
  });
});
