import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BingoCard } from './card';
import styles from './room.css?raw';

const cell = (state: 'open' | 'reach') => ({ number: 7, free: false, state, live: false }) as const;

describe('the completed line animation', () => {
  it('reveals the existing strike without overriding its orientation or intercepting taps', () => {
    const html = renderToString(
      <BingoCard
        cells={[]}
        lines={[
          { kind: 'row', index: 0 },
          { kind: 'col', index: 1 },
          { kind: 'diag', index: 0 },
          { kind: 'diag', index: 1 },
        ]}
        size={5}
      />,
    );
    expect(html.match(/aria-hidden="true" data-bingo-strike=""/gu)).toHaveLength(4);
    expect(html).toContain('translateY(-50%)');
    expect(html).toContain('translateX(-50%)');
    expect(html).toContain('rotate(45deg)');
    expect(html).toContain('rotate(-45deg)');
    expect(styles).toMatch(/pointer-events: none;\s*animation: strike-in var\(--dur-slow\) var\(--ease-out\);/u);
    expect(styles).toMatch(/@keyframes strike-in \{\s*from \{\s*clip-path: inset\(0 100% 100% 0\);\s*\}\s*to \{\s*clip-path: inset\(0\);\s*\}\s*\}/u);
  });

  it('shows the whole strike immediately when reduced motion is requested', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-strike\],[^{]*\{\s*animation: none;/u);
  });
});

describe('the reach animation', () => {
  it('breathes only the open cell that would finish a line, and leaves its neighbour alone', () => {
    const html = renderToString(<BingoCard cells={[cell('open'), cell('reach')]} size={5} />);
    expect(html.match(/data-state="reach"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="7 リーチ"');
    expect(html).toContain('aria-label="7 未マーク"');
    // Reach is an edge on an open cell, so it never carries the blot that would overprint its number.
    expect(html).not.toContain('data-bingo-blot');
  });

  it('never breathes the dash all the way into the fill, because a reach cell with no edge reads as daubed', () => {
    // The 50% stop must stay off var(--reach): the cell's own background is that colour, so an unmixed stop erases the shape cue entirely.
    expect(styles).not.toMatch(/@keyframes reach-breathe \{[^@]*50% \{\s*border-color: var\(--reach\);/u);
  });

  it('breathes the dashed edge on the same timing as a pending blot, and holds it still under reduced motion', () => {
    expect(styles).toMatch(/\[data-bingo-cell\]\[data-state='reach'\] \{[^}]*animation: reach-breathe 1\.6s ease-in-out infinite;/u);
    expect(styles).toMatch(
      /@keyframes reach-breathe \{\s*0%,\s*100% \{\s*border-color: var\(--reach-ink\);\s*\}\s*50% \{\s*border-color: color-mix\(in oklch, var\(--reach\), var\(--reach-ink\) 55%\);\s*\}\s*\}/u,
    );
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-cell\]\[data-state='reach'\] \{\s*animation: none;/u);
  });
});

describe('the draw daub', () => {
  it('marks the cell the room has just called', () => {
    const html = renderToString(<BingoCard cells={[{ number: 7, free: false, state: 'marked', live: true }, cell('open')]} size={5} />);
    expect(html.match(/data-bingo-cell="" data-free="false" data-live="true"/gu)).toHaveLength(1);
    expect(html.match(/data-bingo-cell="" data-free="false" data-live="false"/gu)).toHaveLength(1);
  });

  it('waits out the roll before the blot prints the answer, and holds still under reduced motion', () => {
    // The reel hides the number for var(--dur-slow); a blot that landed on arrival would print it first.
    expect(styles).toMatch(
      /\[data-bingo-cell\]\[data-live='true'\] \[data-bingo-blot\] \{\s*animation: daub-in var\(--dur\) var\(--ease-daub\) var\(--dur-slow\) backwards;\s*\}/u,
    );
    // Backwards fill is what keeps the blot at daub-in's own opacity 0 through the wait, rather than parking a visible blot on the cell.
    expect(styles).toMatch(/\[data-bingo-cell\]\[data-live='true'\] \[data-bingo-num\] \{\s*animation: daub-wait var\(--dur-slow\) steps\(1, end\);\s*\}/u);
    expect(styles).toMatch(/@keyframes daub-wait \{\s*from \{\s*color: var\(--ink\);\s*\}\s*to \{\s*color: var\(--daub-ink\);\s*\}\s*\}/u);
    // The live rule outranks the bare blot selector, so reduced motion has to name it again to win the cascade.
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-cell\]\[data-live='true'\] \[data-bingo-blot\],\s*\[data-bingo-cell\]\[data-live='true'\] \[data-bingo-num\] \{\s*animation: none;/u,
    );
  });

  it('holds the winning edge and the strike bar back with the number that earned them', () => {
    const html = renderToString(<BingoCard cells={[{ number: 7, free: false, state: 'winning', live: true }]} lines={[{ kind: 'row', index: 0 }]} size={5} />);
    expect(html).toContain('data-bingo-card="" data-flat="false" data-live="true"');
    expect(renderToString(<BingoCard cells={[cell('open')]} size={5} />)).toContain('data-live="false"');
    expect(styles).toMatch(/\[data-bingo-cell\]\[data-live='true'\]\[data-state='winning'\] \{\s*animation: win-wait var\(--dur-slow\) steps\(1, end\);\s*\}/u);
    expect(styles).toMatch(
      /@keyframes win-wait \{\s*from \{\s*border-width: var\(--stroke-cell\);\s*border-color: var\(--paper-line\);\s*\}\s*to \{\s*border-width: var\(--stroke-win\);\s*border-color: var\(--win\);\s*\}\s*\}/u,
    );
    // Backwards fill parks the bar on strike-in's own first frame, which is clipped away entirely, so nothing shows through the wait.
    expect(styles).toMatch(
      /\[data-bingo-card\]\[data-live='true'\] \[data-bingo-strike\] \{\s*animation: strike-in var\(--dur-slow\) var\(--ease-out\) var\(--dur-slow\) backwards;\s*\}/u,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-strike\],\s*\[data-bingo-card\]\[data-live='true'\] \[data-bingo-strike\] \{\s*animation: none;/u,
    );
  });

  it('leaves the winning edge alone on a cell no draw has just landed', () => {
    expect(styles).not.toMatch(/\[data-bingo-cell\]\[data-state='winning'\] \{[^}]*animation:/u);
  });
});
