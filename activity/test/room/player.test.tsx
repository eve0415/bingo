import type { UiAction } from '../../app/room/uiState';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { cellMessage, claimMessage } from '../../app/room/commands';
import { Player } from '../../app/room/player';

import { HOST, IDLE, ME, OTHER, PROFILES, card, clickEveryAction, sink, view } from './fixture';

const SHEET = {
  overlay: {
    kind: 'roster',
  },
  panel: 'board',
} as const;

const OPEN_ROSTER: UiAction = {
  type: 'open',
  overlay: {
    kind: 'roster',
  },
};
const DISMISS: UiAction = {
  type: 'dismiss',
};

const REACHING = {
  ...card(ME),
  reach: [[0, 1, 2, 3, 4]],
};

describe('the player screen while the card is in play', () => {
  it('taps its own cells, claims a bingo and calls the roster up over the game', (): void => {
    const out = sink();
    const screen = (
      <Player
        drawnOrder={[5, 20, 31]}
        layout={{ arrangement: 'stack', showCall: true, footer: true, cardMax: 358, callVariant: 'hero', showHistory: true, dense: false, tight: false }}
        me={ME}
        profiles={PROFILES}
        notice={null}
        offline={false}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        pending={[{ cardIx: 0, row: 0, col: 1 }]}
        ui={IDLE}
        view={{
          ...view(),
          cards: [REACHING],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('data-edge="base"');
    expect(html).toContain('<span data-bingo-status="">· <!-- -->接続中</span>');
    expect(html).toContain('data-arrangement="stack" data-bingo-play="" data-tight="false"');
    expect(html).toContain('<div data-bingo-play-card="" data-many="false"');
    expect(html).toContain('style="max-width:358px"');
    expect(html).toContain('data-variant="hero"');
    expect(html).toContain('<span data-bingo-call-progress="">3 / 75</span>');
    expect(html).toContain('data-bingo-history=""');
    expect(html).toContain('リーチ · あと1つ');
    expect(html).toContain('aria-label="2 送信中"');
    expect(html).toContain('参加者 <!-- -->2');
    expect(html).toContain('>ビンゴを宣言</button>');
    expect(html).not.toContain('data-bingo-rail');
    expect(html).not.toContain('data-bingo-scrim');
    expect(html).not.toContain('data-bingo-toast');

    clickEveryAction(screen);
    expect(out.ui).toEqual([OPEN_ROSTER]);
    expect(out.sent).toHaveLength(25);
    expect(out.sent[0]).toEqual(cellMessage(0, 0, 5, false));
    expect(out.sent[12]).toEqual(cellMessage(0, 13, 5, false));
    expect(out.sent).not.toContainEqual(cellMessage(0, 12, 5, true));
    expect(out.sent.at(-1)).toEqual(claimMessage(0));
  });

  it('drops the header and moves the notice beside the card on a landscape frame', (): void => {
    const out = sink();
    const screen = (
      <Player
        drawnOrder={[5]}
        layout={{ arrangement: 'row', showCall: true, footer: false, cardMax: 328, callVariant: 'hero', showHistory: false, dense: true, tight: true }}
        me={ME}
        profiles={PROFILES}
        notice="操作が速すぎます。少し待ってください"
        offline={false}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        pending={[]}
        ui={IDLE}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
            winDetection: 'Auto',
          },
        }}
        visibility="LatestOnly"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('data-edge="tight"');
    expect(html).toContain('<header data-bingo-header=""></header>');
    expect(html).toContain('data-arrangement="row" data-bingo-play="" data-tight="true"');
    expect(html).toContain('<span data-bingo-call-progress="">—</span>');
    expect(html).toContain('data-bingo-toast=""');
    expect(html).toContain('操作が速すぎます。少し待ってください');
    expect(html).toContain('参加者 <!-- -->2');
    expect(html).toContain('role="img"');
    expect(html).not.toContain('data-bingo-wordmark');
    expect(html).not.toContain('data-bingo-history=""');
    expect(html).not.toContain('>ビンゴを宣言</button>');
    expect(html).not.toContain('リーチ · あと1つ');
    expect(html).not.toContain('aria-pressed');

    clickEveryAction(screen);
    expect(out.ui).toEqual([OPEN_ROSTER]);
    expect(out.sent).toEqual([]);
  });

  it('claims on the card that actually holds the bingo, not on the first one dealt', (): void => {
    const out = sink();
    const screen = (
      <Player
        drawnOrder={[5]}
        layout={{ arrangement: 'stack', showCall: true, footer: true, cardMax: 358, callVariant: 'hero', showHistory: true, dense: false, tight: false }}
        me={ME}
        profiles={PROFILES}
        notice={null}
        offline={false}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        pending={[]}
        ui={IDLE}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
            cardsPerPlayer: 2,
          },
          cards: [
            card(ME),
            {
              ...card(ME),
              cardIx: 1,
              bingo: [[0, 1, 2, 3, 4]],
            },
          ],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-play-card="" data-many="true"');
    expect(html).toContain('>ビンゴを宣言</button>');

    clickEveryAction(screen);
    expect(out.sent).toEqual([claimMessage(1)]);
    expect(out.sent).not.toContainEqual(claimMessage(0));
  });
  it('renders what the height budget accounted for, not what the view alone would imply', (): void => {
    const out = sink();
    const screen = (
      <Player
        drawnOrder={[5, 20]}
        layout={{ arrangement: 'stack', showCall: false, footer: false, cardMax: 268, callVariant: 'compact', showHistory: false, dense: false, tight: true }}
        me={ME}
        profiles={PROFILES}
        notice={null}
        offline={false}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={IDLE}
        view={view()}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    // The view carries a claimed-win game with a card in hand and a fully visible draw, all of which the budget declined to make room for.
    expect(html).toContain('番号は非公開です。カードだけを見て遊びます');
    expect(html).not.toContain('data-bingo-call=""');
    expect(html).not.toContain('>ビンゴを宣言</button>');
    expect(html).toContain('<footer data-bingo-footer=""></footer>');

    clickEveryAction(screen);
    expect(out.sent).not.toContainEqual(claimMessage(0));
  });
});

describe('the player screen with no card of its own', () => {
  it('hides the numbers and points a spectator at the next game rather than at a seat', (): void => {
    const out = sink();
    const screen = (
      <Player
        drawnOrder={[5, 20]}
        layout={{ arrangement: 'desk', showCall: false, footer: false, cardMax: 428, callVariant: 'compact', showHistory: false, dense: false, tight: false }}
        me={ME}
        profiles={PROFILES}
        notice={null}
        offline
        onUi={(action): void => {
          out.ui.push(action);
        }}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        pending={[]}
        ui={SHEET}
        view={{
          ...view(),
          players: [HOST, OTHER],
          cards: [],
        }}
        visibility="Hidden"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<span data-bingo-status="">· <!-- -->接続が切れました</span>');
    expect(html).not.toContain('再接続');
    expect(html).toContain('番号は非公開です。カードだけを見て遊びます');
    expect(html).toContain('data-bingo-rail=""');
    expect(html).toContain('data-bingo-scrim=""');
    expect(html).toContain('観戦中');
    expect(html).toContain('このゲームにはカードがありません。次のゲームから参加できます。');
    expect(html).not.toContain('>参加する</button>');
    expect(html).not.toContain('data-bingo-call=""');
    expect(html).not.toContain('参加者 <!-- -->2');
    expect(html).not.toContain('>ビンゴを宣言</button>');

    clickEveryAction(screen);
    expect(out.sent).toEqual([]);
    expect(out.ui).toEqual([DISMISS, DISMISS]);
  });

  it('says nothing about joining, or about claiming, to a seated spectator', (): void => {
    const out = sink();
    const screen = (
      <Player
        drawnOrder={[]}
        layout={{ arrangement: 'stack', showCall: true, footer: false, cardMax: 268, callVariant: 'compact', showHistory: true, dense: false, tight: true }}
        me={ME}
        profiles={PROFILES}
        notice={null}
        offline={false}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        pending={[]}
        ui={IDLE}
        view={{
          ...view(),
          phase: 'Finished',
          cards: [],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('観戦中');
    expect(html).toContain('<span data-bingo-num="">—</span>');
    expect(html).not.toContain('>参加する</button>');
    expect(html).not.toContain('>ビンゴを宣言</button>');

    clickEveryAction(screen);
    expect(out.sent).toEqual([]);
    expect(out.ui).toEqual([OPEN_ROSTER]);
  });
});
