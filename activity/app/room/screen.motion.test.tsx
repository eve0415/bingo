import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import styles from './room.css?raw';
import { Dialog, Sheet, Wordmark } from './screen';

const noop = (): void => undefined;

describe('the header count', () => {
  it('restarts its tick in place when someone arrives', () => {
    expect(renderToString(<Wordmark players={4} />)).toContain('<span data-bingo-players="">4<!-- -->人</span>');
    expect(styles).toMatch(/\[data-bingo-players\] \{\s*animation: count-tick var\(--dur\) var\(--ease-out\) both;/u);
    expect(styles).toMatch(/@keyframes count-tick \{\s*from \{\s*opacity: 0;\s*transform: translateY\(-6px\);\s*\}/u);
  });
});

describe('the overlay animation', () => {
  it('animates the surface itself, leaving the solid scrim it sits on to fade', () => {
    const sheet = renderToString(
      <Sheet onDismiss={noop} title="参加者">
        <p>本文</p>
      </Sheet>,
    );
    const dialog = renderToString(
      <Dialog actions={<button type="button">やめる</button>} onDismiss={noop} title="ゲームを終了しますか">
        <p>本文</p>
      </Dialog>,
    );
    expect(sheet).toContain('data-bingo-surface="sheet"');
    expect(dialog).toContain('data-bingo-surface="dialog"');
    expect(sheet.match(/data-bingo-scrim=""/gu)).toHaveLength(1);
    expect(dialog.match(/data-bingo-scrim=""/gu)).toHaveLength(1);
    expect(styles).toMatch(/\[data-bingo-scrim\] \{[^}]*animation: scrim-in var\(--dur-fast\) var\(--ease-out\);/u);
    expect(styles).toMatch(/\[data-bingo-surface='sheet'\] \{[^}]*animation: sheet-in var\(--dur\) var\(--ease-out\);/u);
    expect(styles).toMatch(/\[data-bingo-surface='dialog'\] \{[^}]*animation: dialog-in var\(--dur\) var\(--ease-out\);/u);
  });

  it('brings the sheet off its edge and the dialog out of its own centre', () => {
    expect(styles).toMatch(/@keyframes scrim-in \{\s*from \{\s*opacity: 0;\s*\}\s*to \{\s*opacity: 1;\s*\}\s*\}/u);
    expect(styles).toMatch(/@keyframes sheet-in \{\s*from \{\s*transform: translateY\(12px\);\s*\}\s*to \{\s*transform: none;\s*\}\s*\}/u);
    expect(styles).toMatch(
      /@keyframes dialog-in \{\s*from \{\s*transform: scale\(0\.96\);\s*opacity: 0;\s*\}\s*to \{\s*transform: none;\s*opacity: 1;\s*\}\s*\}/u,
    );
  });

  it('shows all three at once when reduced motion is requested', () => {
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-scrim\],\s*\[data-bingo-surface='sheet'\],\s*\[data-bingo-surface='dialog'\] \{\s*animation: none;/u,
    );
  });
});
