import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalledNumber } from './call';
import styles from './room.css?raw';

const draw = (value: number): string => renderToString(<CalledNumber latest={{ value, letter: null }} progress="1 / 75" />);

describe('the draw animation', () => {
  it.each([5, 20, 100])('keeps the real call %i accessible underneath decorative reels', value => {
    const html = draw(value);
    expect(html).toContain(`<span data-bingo-call-result="">${value}</span><span aria-hidden="true" data-bingo-reel="">`);
    expect(html.match(/data-bingo-reel-window=""/gu)).toHaveLength(String(value).length);
    expect(html.match(/aria-live="polite"/gu)).toHaveLength(1);
  });

  it('shuffles each digit and lands on the actual number, including a zero digit', () => {
    const html = draw(20);
    expect(html).toContain('<span data-bingo-reel-track=""><span>9</span><span>5</span><span>1</span><span>3</span><span>2</span></span>');
    expect(html).toContain('<span data-bingo-reel-track=""><span>7</span><span>3</span><span>9</span><span>1</span><span>0</span></span>');
    expect(draw(20)).toBe(html);
    expect(draw(21)).not.toBe(html);
  });

  it('leaves the empty call and history still', () => {
    const idle = renderToString(<CalledNumber latest={null} progress="—" />);
    const called = renderToString(<CalledNumber history={[{ value: 5, letter: 'B' }]} latest={{ value: 20, letter: 'I' }} progress="2 / 75" />);
    expect(idle).not.toContain('data-bingo-reel');
    expect(called.match(/data-bingo-reel=""/gu)).toHaveLength(1);
    expect(called).toContain('<span data-bingo-history-item=""><span data-bingo-letter="">B</span><span data-bingo-num="">5</span></span>');
  });

  it('brings each number into the head of the history strip', () => {
    const html = renderToString(
      <CalledNumber
        history={[
          { value: 5, letter: 'B' },
          { value: 9, letter: 'B' },
        ]}
        latest={{ value: 20, letter: 'I' }}
        progress="3 / 75"
      />,
    );
    // Keyed by value, so a number already in the strip keeps its element and only a new one animates in.
    expect(html.match(/data-bingo-history-item=""/gu)).toHaveLength(2);
    // Only the newest entry animates, so a strip that arrives already full does not replay all of itself at once.
    expect(styles).toMatch(/\[data-bingo-history-item\]:first-child \{\s*animation: history-in var\(--dur\) var\(--ease-out\);/u);
    expect(styles).not.toMatch(/\[data-bingo-history-item\] \{[^}]*animation: history-in/u);
    expect(styles).toMatch(
      /@keyframes history-in \{\s*from \{\s*transform: translateX\(-8px\);\s*opacity: 0;\s*\}\s*to \{\s*transform: none;\s*opacity: 1;\s*\}\s*\}/u,
    );
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-history-item\]:first-child \{\s*animation: none;/u);
  });

  it('keeps the reel over the number for the whole roll instead of playing the reveal backwards', () => {
    // `call-reveal ... reverse` negates progress before the step function runs, so the single step fires on the first frame and the reel is hidden for the entire roll, leaving the box blank.
    expect(styles).toMatch(/\[data-bingo-reel\] \{[^}]*animation: call-conceal var\(--dur-slow\) steps\(1, jump-end\) forwards;/u);
    expect(styles).toMatch(/@keyframes call-conceal \{\s*from \{\s*opacity: 1;\s*\}\s*to \{\s*opacity: 0;\s*\}\s*\}/u);
    expect(styles).not.toMatch(/animation:[^;]*reverse/u);
  });

  it('reserves the real number width and removes decorative motion when reduced motion is requested', () => {
    expect(styles).toMatch(/\[data-bingo-reel\] \{\s*position: absolute;\s*inset: 0;/u);
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-call-result\],\s*\[data-bingo-reel-track\] \{\s*animation: none;\s*\}\s*\[data-bingo-reel\] \{\s*display: none;/u,
    );
  });
});
