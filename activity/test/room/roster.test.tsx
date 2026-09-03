import type { RosterEntry } from '../../app/room/roster';

import { playerKey } from '@bingo/wrapper/identity';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RosterRow } from '../../app/room/roster';

import { clickEveryAction } from './fixture';

const HOST_ENTRY = {
  key: playerKey({ issuer: 'discord', subject: 'host-0001' }),
  name: 'ホストさん',
  status: 'host',
  seed: 3,
  isYou: false,
  isHost: true,
  marks: '',
} as const satisfies RosterEntry;

const YOUR_ENTRY = {
  key: playerKey({ issuer: 'discord', subject: 'me-0002' }),
  name: '🎲ぼく',
  status: 'reach',
  seed: 11,
  isYou: true,
  isHost: false,
  marks: '12 / 25',
} as const satisfies RosterEntry;

describe('a roster row', () => {
  it('marks the host and stays a plain row while there is nothing to open', (): void => {
    const html = renderToString(<RosterRow entry={HOST_ENTRY} />);
    expect(html).toContain('data-you="false"');
    expect(html).toContain('<span data-bingo-avatar-host="">▲</span>');
    expect(html).toContain('ホ');
    expect(html).toContain('data-status="host"');
    expect(html).toContain('data-bingo-avatar="" data-seed="3"');
    expect(html).not.toContain('oklch');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-bingo-roster-you');
  });

  it('names you and shows your marks', (): void => {
    const html = renderToString(<RosterRow entry={YOUR_ENTRY} />);
    expect(html).toContain('data-you="true"');
    expect(html).toContain('<span data-bingo-roster-you=""> · あなた</span>');
    expect(html).toContain('<span data-bingo-roster-marks="">12 / 25</span>');
    expect(html).toContain('🎲');
    expect(html).toContain('data-bingo-avatar="" data-seed="1"');
    expect(html).not.toContain('data-bingo-avatar-host');
  });

  it('becomes a control when the host may open the card behind it', (): void => {
    const opened: string[] = [];
    const row = (
      <RosterRow
        entry={YOUR_ENTRY}
        onOpen={(): void => {
          opened.push(YOUR_ENTRY.key);
        }}
      />
    );
    expect(renderToString(row)).toContain('aria-label="🎲ぼくのカードを見る"');

    clickEveryAction(row);
    expect(opened).toEqual([YOUR_ENTRY.key]);
  });
});
