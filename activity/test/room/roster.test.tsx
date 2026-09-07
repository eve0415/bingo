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
  avatar: 'https://cdn.discordapp.com/embed/avatars/2.png',
  isYou: false,
  isHost: true,
  marks: null,
} as const satisfies RosterEntry;

const YOUR_ENTRY = {
  key: playerKey({ issuer: 'discord', subject: 'me-0002' }),
  name: '🎲ぼく',
  status: 'reach',
  seed: 11,
  avatar: null,
  isYou: true,
  isHost: false,
  marks: {
    marked: 12,
    total: 25,
  },
} as const satisfies RosterEntry;

describe('a roster row', () => {
  it('marks the host and stays a plain row while there is nothing to open', (): void => {
    const html = renderToString(<RosterRow entry={HOST_ENTRY} />);
    expect(html).toContain('data-you="false"');
    expect(html).toContain('<span data-bingo-avatar-host="">▲</span>');
    expect(html).toContain('ホ');
    expect(html).toContain('<img alt="" data-bingo-avatar-image="" src="https://cdn.discordapp.com/embed/avatars/2.png"/>');
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
    expect(html).toContain('data-bingo-roster-bar="" data-status="reach"');
    expect(html).toContain('style="inline-size:48%"');
    expect(html).toContain('12<!-- --> / <!-- -->25');
    expect(html).toContain('🎲');
    expect(html).toContain('data-bingo-avatar="" data-seed="1"');
    expect(html).not.toContain('data-bingo-avatar-image');
    expect(html).not.toContain('data-bingo-avatar-host');
  });

  it('names the host in words where a chip would only report the phase', (): void => {
    const html = renderToString(<RosterRow entry={HOST_ENTRY} roster="lobby" />);
    expect(html).toContain('data-roster="lobby"');
    expect(html).toContain('<span data-bingo-roster-person="" title="ホストさん">ホストさん</span>');
    expect(html).toContain('<span data-bingo-roster-role="">ホスト</span>');
    expect(html).toContain('<span data-bingo-avatar-host="">▲</span>');
    expect(html).not.toContain('data-bingo-chip');
    expect(html).not.toContain('data-bingo-roster-marks');
    expect(html).not.toContain('data-bingo-roster-you');
  });

  it('marks which row is yours without a mark count nobody has yet', (): void => {
    const html = renderToString(<RosterRow entry={YOUR_ENTRY} roster="lobby" />);
    expect(html).toContain('<span data-bingo-roster-you="">· あなた</span>');
    expect(html).not.toContain('data-bingo-roster-role');
    expect(html).not.toContain('12 / 25');
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
