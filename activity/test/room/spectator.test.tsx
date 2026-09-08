import type { Panel, UiAction } from '../../app/room/uiState';
import type { JSX } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { seatMessage } from '../../app/room/commands';
import { hostLayout } from '../../app/room/layout';
import { Spectator } from '../../app/room/spectator';

import { HOST, IDLE, KEYS, ME, OTHER, PROFILES, card, clickEveryAction, sink, view } from './fixture';

const DESK = hostLayout({ width: 1200, height: 800 }, 5);
const SPLIT = hostLayout({ width: 800, height: 600 }, 5);
const PHONE = hostLayout({ width: 400, height: 700 }, 5);
const BESIDE = hostLayout({ width: 900, height: 400 }, 5);
const PIP = hostLayout({ width: 380, height: 320 }, 5);

/** The host projection a watcher is sent: every player's card, and the watcher on none of them. */
const WATCHED = {
  ...view(),
  players: [HOST, ME],
  cards: [card(HOST), { ...card(ME), cardIx: 1 }],
};

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
const panelAction = (panel: Panel): UiAction => ({
  type: 'panel',
  panel,
});

describe('the watcher screen', () => {
  it('reads the whole game on a desk and offers nothing to do but take a seat', (): void => {
    const out = sink();
    const screen = (
      <Spectator
        dense={false}
        drawnOrder={[5, 20]}
        layout={DESK}
        me={OTHER}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        ui={IDLE}
        view={WATCHED}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-columns="" data-columns="bench">');
    expect(html).toContain('<span data-bingo-status="">· <!-- -->観戦中</span>');
    expect(html).toContain('data-bingo-flash=""');
    expect(html).toContain('<span data-bingo-count="">2 / 75</span>');
    expect(html).toContain('data-bingo-history');
    expect(html).toContain('<h2 data-bingo-label="">参加者 <span data-bingo-count="">2<!-- -->人</span></h2>');
    expect(html).toContain('aria-label="ホストさんのカードを見る"');
    expect(html).toContain('aria-label="🎲ぼくのカードを見る"');
    expect(html).toContain('data-variant="ghost" type="button">参加する</button>');
    // The room seated neither this viewer nor a card for them, so nothing here is theirs and nothing here is a draw.
    expect(html).not.toContain('あなた');
    expect(html).not.toContain('data-bingo-own');
    expect(html).not.toContain('>番号を引く</button>');
    expect(html).not.toContain('>ゲームを終了</button>');
    expect(html).not.toContain('>ビンゴを宣言</button>');
    expect(html).not.toContain('data-bingo-switch');
    expect(html).not.toContain('data-bingo-recent');
    expect(html).not.toContain('inert');

    clickEveryAction(screen);
    expect(out.ui).toEqual([openCard(KEYS.host), openCard(KEYS.me)]);
    expect(out.sent).toEqual([seatMessage(false)]);
  });

  it('opens one player card from the roster row, with the count of what is marked on it', (): void => {
    const out = sink();
    const screen = (
      <Spectator
        dense={false}
        drawnOrder={[5, 20]}
        layout={SPLIT}
        me={OTHER}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        ui={{ overlay: { kind: 'card', player: KEYS.me }, panel: 'board' }}
        view={WATCHED}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-columns="" data-columns="split">');
    expect(html).toContain('<h2 data-bingo-dialog-title="">🎲ぼくのカード</h2>');
    expect(html).toContain('data-status="playing" data-surface="paper"');
    expect(html).toContain('マーク <!-- -->1<!-- --> / <!-- -->25');
    expect(html).toContain('data-flat="true"');
    expect(html).toContain('>閉じる</button>');
    expect(html).toContain('<main data-bingo-main="" inert="">');
    // A watcher reads somebody else's card; what the host can do from the same dialogue is not theirs to do.
    expect(html).not.toContain('>退出させる</button>');
    expect(html).not.toContain('data-bingo-tabs');

    clickEveryAction(screen);
    expect(out.ui).toEqual([openCard(KEYS.host), openCard(KEYS.me), DISMISS, DISMISS]);
    expect(out.sent).toEqual([seatMessage(false)]);
  });

  it('stacks a switcher of two under the call on a phone', (): void => {
    const out = sink();
    const screen = (
      <Spectator
        dense
        drawnOrder={[5, 20]}
        layout={PHONE}
        me={OTHER}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        ui={IDLE}
        view={WATCHED}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<div data-bingo-columns="" data-columns="one">');
    expect(html).toContain('data-bingo-tabs=""');
    expect(html).toContain('<div data-bingo-panel="" tabindex="0">');
    expect(html).toContain('aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">盤面</button>');
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">参加者<span data-bingo-tab-count="">2</span></button>',
    );
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain('data-bingo-flash=""');
    expect(html).toContain('data-edge="tight"');
    // The host's third segment is their own card, which a watcher does not have.
    expect(html).not.toContain('>カード</button>');

    clickEveryAction(screen);
    expect(out.ui).toEqual([panelAction('board'), panelAction('roster')]);
    expect(out.sent).toEqual([seatMessage(false)]);
  });

  it('puts the roster behind both of the panels that are not the board', (): void => {
    const out = sink();
    const phone = (panel: Panel): JSX.Element => (
      <Spectator
        dense={false}
        drawnOrder={[5, 20]}
        layout={PHONE}
        me={OTHER}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        ui={{ overlay: null, panel }}
        view={WATCHED}
        visibility="Full"
      />
    );
    const roster = renderToString(phone('roster'));
    expect(roster).toContain('<h2 data-bingo-label="">参加者 <span data-bingo-count="">2<!-- -->人</span></h2>');
    expect(roster).toContain('aria-label="🎲ぼくのカードを見る"');
    expect(roster).not.toContain('data-bingo-flash=""');

    // The card panel is the roster as well, because a watcher switching to a card they do not have would find it empty.
    const cards = renderToString(phone('card'));
    expect(cards).toContain('<h2 data-bingo-label="">参加者 <span data-bingo-count="">2<!-- -->人</span></h2>');
    expect(cards).toContain('aria-label="ホストさんのカードを見る"');
    expect(cards).not.toContain('data-bingo-flash=""');
    expect(cards).not.toContain('あなたのカード');
    // The shell owns the panel and this screen offers no card segment, so the one holding the content is the one that has to read as pressed.
    expect(cards).toContain('aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">参加者');

    clickEveryAction(phone('roster'));
    expect(out.ui).toEqual([panelAction('board'), panelAction('roster'), openCard(KEYS.host), openCard(KEYS.me)]);
    expect(out.sent).toEqual([seatMessage(false)]);
  });

  it('moves the call beside the switcher on a frame too short to stack them', (): void => {
    const html = renderToString(
      <Spectator
        dense={false}
        drawnOrder={[5, 20]}
        layout={BESIDE}
        me={OTHER}
        profiles={PROFILES}
        notice={null}
        onSend={(): void => undefined}
        onUi={(): void => undefined}
        ui={IDLE}
        view={WATCHED}
        visibility="Full"
      />,
    );
    expect(html).toContain('<div data-bingo-columns="" data-columns="beside">');
    expect(html).toContain('data-bingo-tabs=""');
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain('<footer data-bingo-footer=""></footer>');
  });

  it('keeps the number, who is close and the seat when Discord leaves room for nothing else', (): void => {
    const out = sink();
    const screen = (
      <Spectator
        dense
        drawnOrder={[5, 20]}
        layout={PIP}
        me={OTHER}
        profiles={PROFILES}
        notice="操作が速すぎます。少し待ってください"
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        ui={IDLE}
        view={WATCHED}
        visibility="Full"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('data-bingo-pip=""');
    expect(html).toContain('<p data-bingo-pip-summary="">参加者 2人 · リーチ 0 · ビンゴ 0</p>');
    expect(html).toContain('data-variant="compact"');
    // Whatever the room refuses has nowhere else to be said, and the seat is the one thing there is still to ask for.
    expect(html).toContain('操作が速すぎます。少し待ってください');
    expect(html).toContain('>参加する</button>');
    expect(html).not.toContain('data-bingo-flash');
    expect(html).not.toContain('data-bingo-tabs');
    expect(html).not.toContain('data-bingo-roster');

    clickEveryAction(screen);
    expect(out.ui).toEqual([]);
    expect(out.sent).toEqual([seatMessage(false)]);
  });

  it('keeps one fewer number beside the call on a narrow phone than on a wide one', (): void => {
    const compact = (dense: boolean): string =>
      renderToString(
        <Spectator
          dense={dense}
          drawnOrder={[3, 9, 22, 41]}
          layout={PHONE}
          me={OTHER}
          profiles={PROFILES}
          notice={null}
          onSend={(): void => undefined}
          onUi={(): void => undefined}
          ui={IDLE}
          view={WATCHED}
          visibility="Full"
        />,
      );
    expect(compact(false).match(/data-bingo-recent-item=""/gu)).toHaveLength(3);
    expect(compact(true).match(/data-bingo-recent-item=""/gu)).toHaveLength(2);
    // The strip lives under the hero box, which this frame has no room for; the compact box keeps its tail inside instead.
    expect(compact(false)).not.toContain('data-bingo-history');
  });

  it('says nothing about cards the room withheld, on the roster or over it', (): void => {
    const out = sink();
    const screen = (
      <Spectator
        dense={false}
        drawnOrder={[]}
        layout={SPLIT}
        me={OTHER}
        profiles={PROFILES}
        notice={null}
        onSend={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        ui={{ overlay: { kind: 'card', player: KEYS.me }, panel: 'board' }}
        view={{ ...WATCHED, cards: [] }}
        visibility="LatestOnly"
      />
    );
    const html = renderToString(screen);
    expect(html).toContain('<span data-bingo-count="">—</span>');
    // The strip says what will be in it only where the room is publishing the draw; under a restriction it would promise a history nobody is going to see.
    expect(html).not.toContain('ホストが番号を引くと');
    expect(html).toContain('<h2 data-bingo-dialog-title="">🎲ぼくのカード</h2>');
    expect(html).toContain('<div data-bingo-roster-row="" data-roster="game" data-you="false">');
    // A restricted draw leaves every row with no card behind it, so there is no count to draw and no grid to open.
    expect(html).not.toContain('のカードを見る');
    expect(html).not.toContain('data-bingo-body');
    expect(html).not.toContain('data-bingo-roster-bar');
    expect(html).not.toContain('data-flat');

    clickEveryAction(screen);
    expect(out.ui).toEqual([DISMISS, DISMISS]);
    expect(out.sent).toEqual([seatMessage(false)]);
  });
});
