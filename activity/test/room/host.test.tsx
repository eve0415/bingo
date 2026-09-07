import type { UiAction } from '../../app/room/uiState';

import { playerKey } from '@bingo/wrapper/identity';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { cellMessage, commandMessage, kickMessage } from '../../app/room/commands';
import { Host } from '../../app/room/host';
import { hostLayout } from '../../app/room/layout';

import { HOST, KEYS, ME, OTHER, PROFILES, card, clickEveryAction, sink, view } from './fixture';

const WIDE = hostLayout({ width: 1200, height: 800 }, 5);
const SPLIT = hostLayout({ width: 800, height: 600 }, 5);
const PHONE = hostLayout({ width: 400, height: 700 }, 7);
const PIP = hostLayout({ width: 380, height: 320 }, 5);

const openCard = (player: string): UiAction => ({
  type: 'open',
  overlay: {
    kind: 'card',
    player,
  },
});
const DISMISS: UiAction = {
  type: 'dismiss',
};

describe('the host screen', () => {
  it('draws, reads the flashboard and keeps its own card in reach', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[5, 20]}
        layout={WIDE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: null, panel: 'board' }}
        view={{
          ...view(),
          players: [HOST, ME, OTHER],
          cards: [card(HOST), { ...card(ME), cardIx: 1 }],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-columns="" data-columns="desk">');
    expect(html).toContain('data-size="sm" data-status="host" data-surface="ground"');
    expect(html).not.toContain('inert');
    expect(html).not.toContain('data-bingo-switch');
    // The count and the total are over the board and inside the call box; the header does not say them a third time.
    expect(html).not.toContain('data-bingo-status');
    expect(html).toContain('<span data-bingo-count="">2 / 75</span>');
    expect(html).toContain('data-lettered="true"');
    expect(html).toContain('<div aria-hidden="true" data-bingo-flash-letter="">B</div>');
    expect(html).toContain('aria-label="5 呼ばれた"');
    expect(html).toContain('aria-label="6 まだ"');
    expect(html).toContain('data-called="true" data-live="false"');
    expect(html).toContain('data-called="true" data-live="true"');
    expect(html).toContain('<h2 data-bingo-label="">参加者 <span data-bingo-count="">3<!-- -->人</span></h2>');
    expect(html).toContain('<span data-bingo-tally="" data-status="reach"><span aria-hidden="true">◆</span> リーチ <!-- -->0</span>');
    expect(html).toContain('<span data-bingo-tally="" data-status="bingo"><span aria-hidden="true">★</span> ビンゴ <!-- -->0</span>');
    // Your own card is already the third column, so your own row is not a way in to it.
    expect(html).not.toContain('aria-label="ホストさんのカードを見る"');
    expect(html).toContain('aria-label="🎲ぼくのカードを見る"');
    expect(html).toContain('<div data-bingo-own="" style="max-width:420px">');
    expect(html).toContain('data-variant="ghost" type="button">取り消す</button>');
    expect(html).toContain('data-variant="primary" type="button">番号を引く</button>');
    expect(html).toContain('>ゲームを終了</button>');
    expect(html).not.toContain('aria-label="プレイヤー 0003のカードを見る"');
    expect(html).not.toContain('data-bingo-scrim');
    expect(html).not.toContain('data-bingo-toast');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('今回はカードを持たずに進行しています');

    clickEveryAction(screen);
    expect(out.ui).toEqual([{ type: 'open', overlay: { kind: 'close' } }, openCard(KEYS.me)]);
    expect(out.sent).toHaveLength(26);
    expect(out.sent.slice(0, 2)).toEqual([commandMessage('Undo'), commandMessage('Draw')]);
    expect(out.sent[2]).toEqual(cellMessage(0, 0, 5, false));
    expect(out.sent).not.toContainEqual(cellMessage(0, 12, 5, true));
    expect(out.sent.at(-1)).toEqual(cellMessage(0, 24, 5, false));
  });

  it('drops the draw into the footer of a phone and confirms closing the game', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[3]}
        layout={PHONE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice="操作が速すぎます。少し待ってください"
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: { kind: 'close' }, panel: 'board' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            size: 7,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="LatestOnly"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('data-bingo-tabs=""');
    // The flashboard panel holds no control, so the region it scrolls has to be reachable in its own right.
    expect(html).toContain('<div data-bingo-panel="" tabindex="0">');
    expect(html).toContain('aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">盤面</button>');
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">参加者<span data-bingo-tab-count="">2</span></button>',
    );
    expect(html).toContain('>カード</button>');
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain('<div data-bingo-columns="" data-columns="one">');
    expect(html).toContain('data-bingo-switch=""');
    expect(html).toContain('<header data-bingo-header="" inert="">');
    expect(html).toContain('<main data-bingo-main="" inert="">');
    expect(html).toContain('<footer data-bingo-footer="" inert="">');
    expect(html).not.toContain('data-status="host"');
    expect(html).toContain('data-lettered="false"');
    expect(html).toContain('<div aria-hidden="true" data-bingo-flash-letter=""></div>');
    expect(html).toContain('<span data-bingo-count="">—</span>');
    expect(html).toContain('操作が速すぎます。少し待ってください');
    expect(html).toContain('<h2 data-bingo-dialog-title="">ゲームを終了しますか</h2>');
    expect(html).toContain('いまの番号とカードは記録に残ります。全員が待機中に戻ります。');
    expect(html).toContain('<div data-bingo-surface="dialog" tabindex="-1">');
    expect(html).toContain('data-variant="secondary" type="button">やめる</button>');
    expect(html).toContain('data-variant="danger" type="button">終了する</button>');
    expect(html).toContain('aria-label="105 まだ"');
    expect(html).not.toContain('data-bingo-tally');
    expect(html).not.toContain('あなたのカード');

    clickEveryAction(screen);
    expect(out.ui).toEqual([
      { type: 'open', overlay: { kind: 'close' } },
      { type: 'panel', panel: 'board' },
      { type: 'panel', panel: 'roster' },
      { type: 'panel', panel: 'card' },
      DISMISS,
      DISMISS,
      DISMISS,
    ]);
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw'), commandMessage('Close')]);
  });

  it('swaps the phone panel without disturbing the call above it', (): void => {
    const html = renderToString(
      <Host
        drawnOrder={[3]}
        layout={PHONE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(): void => undefined}
        onUi={(): void => undefined}
        pending={[]}
        ui={{ overlay: null, panel: 'card' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            size: 7,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="LatestOnly"
      />,
    );
    expect(html).toContain('<h2 data-bingo-label="">あなたのカード</h2>');
    expect(html).toContain('data-bingo-reserved="" data-slot="reach"');
    expect(html).toContain('今回はカードを持たずに進行しています');
    // The counts sit under the call, so a host reading the card panel still sees who is close.
    expect(html).toContain('<p data-bingo-label="">参加者 <!-- -->2<!-- -->人 · リーチ <!-- -->0<!-- --> · ビンゴ <!-- -->0</p>');
    expect(html).toContain('data-bingo-call=""');
    expect(html).toContain('aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">カード</button>');
    expect(html).not.toContain('data-bingo-flash=""');
    expect(html).not.toContain('data-bingo-tally');
  });

  it('keeps one fewer number beside the call on a narrow phone than on a wide one', (): void => {
    const compact = (dense: boolean): string =>
      renderToString(
        <Host
          drawnOrder={[3, 9, 22, 41]}
          layout={PHONE}
          dense={dense}
          me={HOST}
          profiles={PROFILES}
          notice={null}
          onSend={(): void => undefined}
          onUi={(): void => undefined}
          pending={[]}
          ui={{ overlay: null, panel: 'board' }}
          view={view()}
          visibility="Full"
        />,
      );
    expect(compact(false).match(/data-bingo-recent-item=""/gu)).toHaveLength(3);
    expect(compact(true).match(/data-bingo-recent-item=""/gu)).toHaveLength(2);
    // The strip lives under the hero box; the compact one has no room for it, which is why its tail is inside.
    expect(compact(false)).not.toContain('data-bingo-history');
  });

  it('keeps the number, the tally and the draw when Discord leaves room for nothing else', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[3]}
        layout={PIP}
        dense
        me={HOST}
        profiles={PROFILES}
        notice="操作が速すぎます。少し待ってください"
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: null, panel: 'board' }}
        view={view()}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('data-bingo-pip-host=""');
    expect(html).toContain('<p data-bingo-label="">参加者 <!-- -->2<!-- -->人 · リーチ <!-- -->0<!-- --> · ビンゴ <!-- -->0</p>');
    // The draw is the one thing that still has to work, and the header is still the only way out of the game.
    expect(html).toContain('data-bingo-actions="" data-stack="true"');
    expect(html).toContain('>ゲームを終了</button>');
    // Whatever the room refuses has nowhere else to be said.
    expect(html).toContain('操作が速すぎます。少し待ってください');
    expect(html).not.toContain('data-bingo-flash');
    expect(html).not.toContain('data-bingo-tabs');
    expect(html).not.toContain('data-bingo-chip');

    clickEveryAction(screen);
    expect(out.sent).toEqual([commandMessage('Draw'), commandMessage('Undo')]);
  });

  it('shows the roster on the phone when that is the panel the host chose', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[3]}
        layout={PHONE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: null, panel: 'roster' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            size: 7,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="LatestOnly"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<h2 data-bingo-label="">参加者 <span data-bingo-count="">2<!-- -->人</span></h2>');
    expect(html).toContain('aria-label="🎲ぼくのカードを見る"');
    expect(html).not.toContain('data-bingo-flash=""');
    expect(html).not.toContain('あなたのカード');

    clickEveryAction(screen);
    expect(out.ui).toContainEqual(openCard(KEYS.me));
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw')]);
  });

  it('stops drawing once the pool is spent and confirms removing a player', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={Array.from({ length: 75 }, (_unused, index) => index + 1)}
        layout={SPLIT}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: { kind: 'kick', player: KEYS.me }, panel: 'board' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-columns="" data-columns="split">');
    expect(html).toContain('<span data-bingo-count="">75 / 75</span>');
    expect(html).toContain('disabled=""');
    expect(html).toContain('<h2 data-bingo-dialog-title="">🎲ぼくを退出させますか</h2>');
    expect(html).toContain('この部屋から外れます。もう一度招待すれば戻れます。');
    expect(html).toContain('<div data-bingo-surface="dialog" tabindex="-1">');
    expect(html).toContain('data-variant="secondary" type="button">やめる</button>');
    expect(html).toContain('data-variant="danger" type="button">退出させる</button>');

    clickEveryAction(screen);
    expect(out.ui).toEqual([{ type: 'open', overlay: { kind: 'close' } }, openCard(KEYS.me), DISMISS, DISMISS, DISMISS]);
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw'), kickMessage(ME)]);
  });

  it('shows nothing for a card belonging to someone the roster no longer holds', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[]}
        layout={SPLIT}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: { kind: 'card', player: playerKey({ issuer: 'discord', subject: 'nobody' }) }, panel: 'board' }}
        view={{
          ...view(),
          phase: 'Lobby',
          players: [HOST, ME],
          cards: [card(HOST)],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<span data-bingo-num="">—</span>');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('data-bingo-scrim');
    expect(html).not.toContain('aria-pressed');
    // A player can leave while the host is reading their card, and the screen goes inert behind an overlay whether or not it drew one.
    // An overlay with nobody left to be about has to be dropped rather than rendered as nothing.
    expect(html).not.toContain('inert');

    clickEveryAction(screen);
    expect(out.ui).toEqual([{ type: 'open', overlay: { kind: 'close' } }]);
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw')]);
  });

  it('moves the call beside the switcher, with the draw controls, on a frame too short to stack them', (): void => {
    const out = sink();
    const screen = (
      <Host
        dense={false}
        drawnOrder={[3]}
        layout={hostLayout({ width: 900, height: 400 }, 5)}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: null, panel: 'board' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-columns="" data-columns="beside">');
    expect(html).toContain('data-bingo-switch=""');
    expect(html).toContain('>番号を引く</button>');
    // The draw travels with the call rather than pinning itself to the footer, which a short frame cannot spare.
    expect(html).toContain('<footer data-bingo-footer=""></footer>');
    expect(html).not.toContain('data-status="host"');

    clickEveryAction(screen);
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw')]);
  });

  it('refuses an undo before anything has been drawn', (): void => {
    const html = renderToString(
      <Host
        drawnOrder={[]}
        layout={WIDE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(): void => undefined}
        onUi={(): void => undefined}
        pending={[]}
        ui={{ overlay: null, panel: 'board' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="Full"
      />,
    );
    expect(html).toContain('data-variant="ghost" disabled="" type="button">取り消す</button>');
    expect(html).toContain('data-variant="primary" type="button">番号を引く</button>');
  });

  it('ignores a menu the lobby left open, which would otherwise make the whole screen inert over nothing', (): void => {
    const html = renderToString(
      <Host
        drawnOrder={[5]}
        layout={WIDE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(): void => undefined}
        onUi={(): void => undefined}
        pending={[]}
        ui={{ overlay: { kind: 'menu', player: KEYS.me }, panel: 'board' }}
        view={{
          ...view(),
          players: [HOST, ME],
        }}
        visibility="Full"
      />,
    );
    expect(html).not.toContain('inert');
    expect(html).not.toContain('data-bingo-surface');
    expect(html).toContain('>番号を引く</button>');
  });

  it('opens a card the game has not started marking without an empty count over it', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[]}
        layout={WIDE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: { kind: 'card', player: KEYS.me }, panel: 'board' }}
        view={{
          ...view(),
          phase: 'Lobby',
          players: [HOST, ME],
          cards: [card(ME)],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<h2 data-bingo-dialog-title="">🎲ぼくのカード</h2>');
    expect(html).toContain('data-flat="true"');
    // Nobody has marked anything yet, so there is no count — and an empty one would read as a count of nothing.
    expect(html).not.toContain('data-bingo-body');
  });

  it('shows nothing for an overlay naming the host themselves', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[5]}
        layout={WIDE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[]}
        ui={{ overlay: { kind: 'card', player: KEYS.host }, panel: 'board' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [card(HOST)],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).not.toContain('data-bingo-scrim');
    expect(html).not.toContain('data-bingo-dialog-title');
    expect(html).not.toContain('>退出させる</button>');
    // The card is the third column already, so nothing on this screen is behind an overlay either.
    expect(html).not.toContain('inert');

    clickEveryAction(screen);
    expect(out.ui).toEqual([{ type: 'open', overlay: { kind: 'close' } }]);
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw')]);
  });

  it('opens the card of one player and offers the removal from there', (): void => {
    const out = sink();
    const screen = (
      <Host
        drawnOrder={[5, 20]}
        layout={WIDE}
        dense={false}
        me={HOST}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        pending={[{ cardIx: 0, row: 2, col: 0 }]}
        ui={{ overlay: { kind: 'card', player: KEYS.me }, panel: 'board' }}
        view={{
          ...view(),
          config: {
            ...view().config,
            daub: 'Auto',
          },
          players: [HOST, ME],
          cards: [
            {
              ...card(ME),
              bingo: [[0, 1, 2, 3, 4]],
            },
          ],
        }}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<h2 data-bingo-dialog-title="">🎲ぼくのカード</h2>');
    expect(html).toContain('data-status="bingo" data-surface="paper"');
    expect(html).toContain('マーク <!-- -->1<!-- --> / <!-- -->25');
    expect(html).toContain('data-flat="true"');
    expect(html).toContain('aria-label="11 送信中"');
    expect(html).toContain('data-bingo-strike=""');
    expect(html).toContain('<h2 data-bingo-label="">参加者 <span data-bingo-count="">2<!-- -->人</span></h2>');
    expect(html).toContain('<span data-bingo-tally="" data-status="bingo"><span aria-hidden="true">★</span> ビンゴ <!-- -->1</span>');
    expect(html).toContain('>閉じる</button>');

    clickEveryAction(screen);
    expect(out.ui).toEqual([
      { type: 'open', overlay: { kind: 'close' } },
      openCard(KEYS.me),
      DISMISS,
      {
        type: 'open',
        overlay: {
          kind: 'kick',
          player: KEYS.me,
        },
      },
      DISMISS,
    ]);
    expect(out.sent).toEqual([commandMessage('Undo'), commandMessage('Draw')]);
  });
});
