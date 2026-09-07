import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HOST, PROFILES, view } from '../../test/room/fixture';

import { Host } from './host';
import { hostLayout } from './layout';
import styles from './room.css?raw';

const noop = (): void => undefined;

const flashboard = (drawnOrder: readonly number[]): string =>
  renderToString(
    <Host
      dense={false}
      drawnOrder={drawnOrder}
      layout={hostLayout({ width: 1200, height: 800 }, 5)}
      me={HOST}
      notice={null}
      onSend={noop}
      onUi={noop}
      pending={[]}
      profiles={PROFILES}
      ui={{ overlay: null, panel: 'board' }}
      view={view()}
      visibility="Full"
    />,
  );

describe('the flashboard animation', () => {
  it('marks exactly the number just called, so only that cell lands', () => {
    const html = flashboard([5, 20]);
    expect(html.match(/data-live="true"/gu)).toHaveLength(1);
    expect(html).toContain('data-called="true" data-live="true" role="img">20</div>');
    expect(html).toContain('data-called="true" data-live="false" role="img">5</div>');
  });

  it('leaves a board nobody has drawn from with nothing to land', () => {
    expect(flashboard([])).not.toContain('data-live="true"');
  });

  it('lands the live cell on the daub curve and holds it still under reduced motion', () => {
    expect(styles).toMatch(
      /\[data-bingo-flash-cell\]\[data-live='true'\] \{[^}]*animation:\s*flash-wait var\(--dur-slow\) steps\(1, end\),\s*flash-live var\(--dur\) var\(--ease-daub\) var\(--dur-slow\);/u,
    );
    expect(styles).toMatch(/@keyframes flash-live \{\s*from \{\s*transform: scale\(0\.86\);\s*\}\s*to \{\s*transform: scale\(1\);\s*\}\s*\}/u);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-bingo-flash-cell\]\[data-live='true'\] \{\s*animation: none;/u);
  });

  it('waits out the roll before the board says which number it was', () => {
    // The reel spends var(--dur-slow) hiding the number; a cell that lit up on arrival would read it out first.
    expect(styles).toMatch(
      /@keyframes flash-wait \{\s*from \{\s*background: var\(--ground\);\s*color: var\(--on-ground-2\);\s*font-weight: 500;\s*box-shadow: none;\s*\}\s*to \{\s*background: var\(--live\);/u,
    );
    // The hold is only invisible while it repeats the look of a cell nobody has called, so the two move together.
    expect(styles).toMatch(/\[data-bingo-flash-cell\] \{[^}]*background: var\(--ground\);[^}]*color: var\(--on-ground-2\);[^}]*font-weight: 500;/u);
  });
});
