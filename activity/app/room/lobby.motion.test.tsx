import { describe, expect, it } from 'vitest';

import styles from './room.css?raw';

describe('the lobby roster animation', () => {
  it('fills the roster in rather than showing it all at once', () => {
    expect(styles).toMatch(/\[data-bingo-roster-line\] \{\s*animation: row-in var\(--dur\) var\(--ease-out\) both;/u);
    expect(styles).toMatch(/\[data-bingo-roster-line\]:nth-child\(2\) \{\s*animation-delay: 40ms;/u);
    expect(styles).toMatch(/\[data-bingo-roster-line\]:nth-child\(n \+ 4\) \{\s*animation-delay: 120ms;/u);
    expect(styles).toMatch(/@keyframes row-in \{\s*from \{\s*opacity: 0;\s*transform: translateX\(-10px\);\s*\}/u);
  });

  // The delays are literals rather than tokens, so the media query that zeroes the token scale cannot reach them.
  it('holds the whole roster still when reduced motion is asked for', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-roster-line\] \{\s*animation: none;/u);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-waiting-dot\] \{\s*animation: none;/u);
  });

  // The game roster remounts every time the host taps 参加者, so the badge is scoped to the roster that does not.
  it('pops the host badge only on the roster nothing remounts', () => {
    expect(styles).toMatch(
      /\[data-bingo-roster-row\]\[data-roster='lobby'\] \[data-bingo-avatar-host\] \{\s*animation: badge-in var\(--dur-slow\) var\(--ease-daub\) both;/u,
    );
    expect(styles).toMatch(/@keyframes badge-in \{\s*from \{\s*transform: scale\(0\);\s*\}\s*70% \{\s*transform: scale\(1\.25\);/u);
  });
});
