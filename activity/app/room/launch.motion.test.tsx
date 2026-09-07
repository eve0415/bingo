import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Launch } from './launch';
import styles from './room.css?raw';

describe('the launch animation', () => {
  it('keeps the finished steps landed and only the running one breathing', () => {
    const html = renderToString(<Launch step="participants" />);
    expect(html.match(/data-state="marked"/gu)).toHaveLength(3);
    expect(html.match(/data-state="pending"/gu)).toHaveLength(1);
    expect(html).toContain('aria-valuenow="4"');
  });

  it('does not land a step that was already done, because the launch is rebuilt as the handshake hands over', () => {
    expect(styles).toMatch(/\[data-bingo-launch-strip\] \[data-bingo-cell\]\[data-state='marked'\] \[data-bingo-blot\] \{\s*animation: none;\s*\}/u);
  });
});
