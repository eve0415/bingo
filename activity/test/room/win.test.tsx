import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { commandMessage, newGameMessage } from '../../app/room/commands';
import { Win } from '../../app/room/win';

import { HOST, ME, OTHER, PROFILES, card, clickEveryAction, view } from './fixture';

const finished = (sent: ClientMessage[]): JSX.Element => (
  <Win
    dense={false}
    host
    profiles={PROFILES}
    notice="そろっている列がありません"
    onSend={(message): void => {
      sent.push(message);
    }}
    players={3}
    view={{
      ...view(),
      phase: 'Finished',
      revealedSeed: 'seed-2f9c',
      wins: [
        {
          winners: [HOST, ME],
          patterns: [[0, 1, 2, 3, 4]],
          atSeq: 12,
          rank: 1,
        },
      ],
      cards: [
        {
          ...card(HOST),
          bingo: [[0, 1, 2, 3, 4]],
        },
        {
          ...card(ME),
          cardIx: 1,
          bingo: [[0, 5, 10, 15, 20]],
        },
        {
          ...card(OTHER),
          cardIx: 2,
        },
      ],
    }}
  />
);

const empty = (sent: ClientMessage[]): JSX.Element => (
  <Win
    dense
    host={false}
    profiles={PROFILES}
    notice={null}
    onSend={(message): void => {
      sent.push(message);
    }}
    players={2}
    view={{
      ...view(),
      phase: 'Finished',
      cards: [],
    }}
  />
);

describe('the result screen', () => {
  it('names the winners, strikes their lines and publishes the seed', (): void => {
    const html = renderToString(finished([]));
    expect(html).toContain('<span data-bingo-status="">· <!-- -->終了</span>');
    expect(html).toContain('data-edge="base"');
    expect(html).toContain('<h2 data-bingo-result-title="">ビンゴ</h2>');
    expect(html).toContain('<p data-bingo-body="">おつかれさまでした。</p>');
    expect(html).not.toContain('さん、おつかれさまでした');
    expect(html).toContain('<span data-bingo-rank="">1<!-- -->位</span>');
    expect(html).toContain('<span data-bingo-winner-names="">ホストさん、🎲ぼく</span>');
    expect(html).toContain('公開されたシード seed-2f9c');
    expect(html).toContain('data-flat="true"');
    expect(html).toContain('style="max-width:320px"');
    expect(html.match(/data-bingo-strike=""/gu)).toHaveLength(2);
    expect(html).toContain('>もう一回</button>');
    expect(html).toContain('そろっている列がありません');
    expect(html).not.toContain('退出する');
  });

  it('offers the host another game and nobody a way out of a game the engine has closed', (): void => {
    const sent: ClientMessage[] = [];
    clickEveryAction(finished(sent));
    expect(sent).toEqual([newGameMessage(null)]);
    expect(sent).not.toContainEqual(commandMessage('Leave'));
  });

  it('says plainly when a game ended with nobody winning', (): void => {
    const sent: ClientMessage[] = [];
    const html = renderToString(empty(sent));
    expect(html).toContain('<h2 data-bingo-result-title="">ビンゴは出ませんでした</h2>');
    expect(html).toContain('次のゲームで続けられます。');
    expect(html).toContain('シードはまもなく公開されます');
    expect(html).toContain('<ol data-bingo-winners=""></ol>');
    expect(html).toContain('data-edge="tight"');
    expect(html).toContain('data-slot="toast"></div>');
    expect(html).not.toContain('>もう一回</button>');
    expect(html).toContain('<div data-bingo-actions=""></div>');

    clickEveryAction(empty(sent));
    expect(sent).toEqual([]);
  });
});
