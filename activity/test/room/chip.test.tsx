import type { PlayerStatus } from '../../app/room/chip';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StatusChip } from '../../app/room/chip';

const STATUSES = ['waiting', 'playing', 'reach', 'bingo', 'host'] as const satisfies PlayerStatus[];

describe('the status chip', () => {
  it('gives every status a shape as well as a colour', (): void => {
    const html = STATUSES.map(status => renderToString(<StatusChip status={status} />));
    expect(html.map(markup => markup.includes('data-size="md"'))).toEqual([true, true, true, true, true]);
    expect(html.map(markup => markup.includes('data-surface="ground"'))).toEqual([true, true, true, true, true]);
    for (const [index, glyph] of ['◇', '●', '◆', '★', '▲'].entries()) expect(html[index]).toContain(`>${glyph}</span>`);
    for (const [index, label] of ['待機中', 'プレイ中', 'リーチ', 'ビンゴ', 'ホスト'].entries()) expect(html[index]).toContain(`<span>${label}</span>`);
    for (const [index, status] of STATUSES.entries()) expect(html[index]).toContain(`data-status="${status}"`);
  });

  it('shrinks onto a paper surface when the dialogue asks it to', (): void => {
    const html = renderToString(<StatusChip size="sm" status="bingo" surface="paper" />);
    expect(html).toContain('data-size="sm"');
    expect(html).toContain('data-surface="paper"');
  });
});
