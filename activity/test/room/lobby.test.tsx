import type { LobbyLayout } from '../../app/room/layout';
import type { UiState } from '../../app/room/uiState';
import type { Sink } from './fixture';
import type { ComponentProps, JSX } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  commandMessage,
  daubMessage,
  kickMessage,
  newGameMessage,
  settingsMessage,
  sizeMessage,
  transferHostMessage,
  winLimitMessage,
} from '../../app/room/commands';
import { lobbyLayout } from '../../app/room/layout';
import { Lobby } from '../../app/room/lobby';

import { HOST, IDLE, KEYS, ME, OTHER, PROFILES, clickEveryAction, committedRoom, config, sink, view } from './fixture';

const DESK = lobbyLayout({ width: 1200, height: 800 });
const PHONE = lobbyLayout({ width: 390, height: 844 });
const SLIVER = lobbyLayout({ width: 640, height: 300 });

/** Everything a lobby needs, with only what a test is actually about spelled out at its call site. */
const lobby = (out: Sink, overrides: Partial<ComponentProps<typeof Lobby>> = {}): JSX.Element => (
  <Lobby
    commitment={null}
    gameIndex={0}
    host
    layout={PHONE}
    me={HOST}
    notice={null}
    onSend={(message): void => {
      out.sent.push(message);
    }}
    onUi={(action): void => {
      out.ui.push(action);
    }}
    profiles={PROFILES}
    ui={IDLE}
    view={{
      ...view(),
      phase: 'Lobby',
      players: [HOST, ME, OTHER],
      cards: [],
    }}
    visibility="Full"
    {...overrides}
  />
);

const hostLobby = (out: Sink, ui: UiState = IDLE, layout: LobbyLayout = DESK): JSX.Element =>
  lobby(out, {
    commitment: committedRoom().commitment,
    gameIndex: 7,
    layout,
    notice: 'この操作はホストだけができます',
    ui,
  });

const guestLobby = (out: Sink): JSX.Element =>
  lobby(out, {
    host: false,
    me: ME,
    view: {
      ...view(),
      phase: 'Lobby',
      players: [OTHER],
      cards: [],
    },
  });

describe('the lobby as the host', () => {
  it('leads with the roster and offers the settings as one control per decision', (): void => {
    const html = renderToString(hostLobby(sink()));
    // Nothing in a lobby read by a guest is focusable, so the region it scrolls has to be reachable in its own right.
    expect(html).toContain('<div data-bingo-lobby="" data-columns="split" tabindex="0">');
    expect(html).toContain('data-edge="wide"');
    // The roster is the first column: the lobby's question is who is here.
    expect(html.indexOf('参加者')).toBeLessThan(html.indexOf('次のゲームの設定'));
    expect(html).toContain('<h2 data-bingo-label="">参加者</h2>');
    expect(html).toContain('<span data-bingo-count="">3<!-- -->人</span>');
    expect(html).toContain('<h2 data-bingo-label="">次のゲームの設定</h2>');
    expect(html).toContain('カードの設定を変えるとゲームを作り直します');
    expect(html).toContain('<span data-bingo-setting-title="">カード</span>');
    expect(html).toContain('<span data-bingo-setting-sub="">マスの数</span>');
    expect(html).toContain('<div data-bingo-settings="" data-rows="beside">');
    expect(html).toContain('aria-label="終わり方" data-bingo-choices="" data-group="winLimit" role="radiogroup"');
    // The chosen option is a checked radio rather than a button claiming to be one, so the arrow keys are the browser's.
    expect(html).toContain('<label data-bingo-choice="" data-on="true">');
    expect(html).toContain('<input data-bingo-choice-input="" type="radio" name="size" checked=""/>');
    expect(html).toContain('<span data-bingo-choice-label="">5×5</span>');
    expect(html).toContain('<span data-bingo-choice-label="">最後まで</span>');
    expect(html).toContain('<span data-bingo-choice-label="">最新だけ</span>');
    // The chosen option explains itself once, under the control rather than beside every option.
    expect(html).toContain('<p data-bingo-setting-hint="">いつものビンゴ。B-I-N-G-O の5列</p>');
    expect(html).toContain('<span aria-hidden="true" data-bingo-dots="" data-size="9">');
    expect(html).toContain(`${'a'.repeat(16)} ${'b'.repeat(16)} cc`);
    expect(html).toContain('ゲーム 7 の開始時に公開');
    expect(html).toContain('>参加しない</button>');
    expect(html).toContain('>ゲームを開始</button>');
    expect(html).toContain('<span data-bingo-toast="">');
    expect(html).toContain('この操作はホストだけができます');
    expect(html).not.toContain('新しいゲームを作る');
    expect(html).not.toContain('ホストの開始を待っています');
    expect(html).not.toContain('data-bingo-setting-value');
    expect(html).not.toContain('data-bingo-roster-empty');
    expect(html).not.toContain('disabled=""');
  });

  it('sends exactly the message each setting stands for, and opens a menu rather than acting on a person', (): void => {
    const out = sink();
    clickEveryAction(hostLobby(out));
    expect(out.sent).toEqual([
      sizeMessage(config(), 3),
      sizeMessage(config(), 5),
      sizeMessage(config(), 7),
      sizeMessage(config(), 9),
      daubMessage(config(), 'Auto'),
      daubMessage(config(), 'Manual'),
      winLimitMessage(config(), 'Unlimited'),
      winLimitMessage(config(), 'FirstOnly'),
      winLimitMessage(config(), { Count: 3 }),
      winLimitMessage(config(), { Count: 5 }),
      settingsMessage({ drawnVisibility: 'Full' }),
      settingsMessage({ drawnVisibility: 'LatestOnly' }),
      settingsMessage({ drawnVisibility: 'Hidden' }),
      commandMessage('Leave'),
      commandMessage('Start'),
    ]);
    expect(out.ui).toEqual([
      { type: 'open', overlay: { kind: 'menu', player: KEYS.me } },
      { type: 'open', overlay: { kind: 'menu', player: KEYS.other } },
    ]);
  });

  it('keeps removing someone and handing the room over behind the row they belong to', (): void => {
    const out = sink();
    const screen = hostLobby(out, { overlay: { kind: 'menu', player: KEYS.me }, panel: 'board' });
    const html = renderToString(screen);
    expect(html).toContain('aria-expanded="true" aria-haspopup="menu" aria-label="🎲ぼくの操作"');
    expect(html).toContain('aria-expanded="false" aria-haspopup="menu" aria-label="プレイヤー 0003の操作"');
    expect(html).toContain('<button aria-label="メニューを閉じる" data-bingo-menu-dismiss="" type="button"></button>');
    expect(html).toContain('<div aria-label="🎲ぼくの操作" data-bingo-menu="" role="menu">');
    // The role promises the arrow keys work and that the menu is one tab stop; opening it puts focus on the first item.
    expect(html).toContain('autofocus=""');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    // Escape closes it and hands focus back to the button that opened it, so the keyboard is never left on nothing.
    expect(html).toContain('data-bingo-menu=""');
    expect(html).toContain('ホストにする');
    expect(html).toContain('data-danger="true"');
    expect(html).toContain('退出させる');
    // Only the row whose menu is open carries one.
    expect(html.match(/data-bingo-menu=""/gu)).toHaveLength(1);

    clickEveryAction(screen);
    expect(out.sent).toContainEqual(kickMessage(ME));
    expect(out.sent).not.toContainEqual(kickMessage(OTHER));
    expect(out.ui).toContainEqual({ type: 'dismiss' });
    expect(out.ui).toContainEqual({ type: 'open', overlay: { kind: 'promote', player: KEYS.me } });
  });

  it('confirms a handover before it happens, because it is the one change the host cannot undo', (): void => {
    const out = sink();
    const screen = hostLobby(out, { overlay: { kind: 'promote', player: KEYS.me }, panel: 'board' });
    const html = renderToString(screen);
    expect(html).toContain('<h2 data-bingo-dialog-title="">🎲ぼくをホストにしますか</h2>');
    expect(html).toContain('あなたはホストではなくなり、参加者として続けます。設定と進行はその人に移ります。');
    expect(html).toContain('<main data-bingo-main="" inert="">');
    expect(html).toContain('data-variant="paper" type="button">ホストにする</button>');
    expect(html).toContain('data-variant="secondary" type="button">やめる</button>');

    clickEveryAction(screen);
    expect(out.sent).toContainEqual(transferHostMessage(ME));
    expect(out.ui.filter(action => action.type === 'dismiss')).not.toHaveLength(0);
  });

  it('says who is missing rather than showing an empty column, and offers nothing to start', (): void => {
    const html = renderToString(
      lobby(sink(), {
        view: {
          ...view(),
          phase: 'Lobby',
          players: [],
          cards: [],
        },
        visibility: 'Hidden',
      }),
    );
    expect(html).toContain('data-edge="base"');
    expect(html).toContain('<div data-bingo-lobby="" data-columns="one" tabindex="0">');
    expect(html).toContain('<div data-bingo-settings="" data-rows="stacked">');
    expect(html).toContain('このアクティビティを開いた人から、ここに並びます');
    expect(html).toContain('<span data-bingo-count="">0<!-- -->人</span>');
    expect(html).toContain('disabled=""');
    expect(html).toContain('<span data-bingo-choice-label="">隠す</span>');
    expect(html).not.toContain('カードの設定を変えるとゲームを作り直します');
    // Nobody is seated, so no row carries a menu and the outline has nothing to line up with.
    expect(html).not.toContain('data-bingo-menu-spacer');
  });

  it('keeps the outline in line with the one row that does carry a menu', (): void => {
    const html = renderToString(
      lobby(sink(), {
        view: {
          ...view(),
          phase: 'Lobby',
          players: [OTHER],
          cards: [],
        },
      }),
    );
    expect(html).toContain('このアクティビティを開いた人から、ここに並びます');
    expect(html).toContain('<span aria-hidden="true" data-bingo-menu-spacer=""></span>');
    expect(html).toContain('aria-haspopup="menu" aria-label="プレイヤー 0003の操作"');
  });

  it('marks a counted limit as the chosen one, though the room and the control never share an object', (): void => {
    const out = sink();
    const counted = lobby(out, {
      gameIndex: 2,
      view: {
        ...view(),
        phase: 'Lobby',
        players: [HOST, ME],
        cards: [],
        config: {
          ...view().config,
          winLimit: {
            Count: 3,
          },
        },
      },
    });
    const html = renderToString(counted);
    expect(html).toContain('<p data-bingo-setting-hint="">3人がビンゴになったら終了します</p>');
    expect(html).toContain(
      '<label data-bingo-choice="" data-on="true"><input data-bingo-choice-input="" type="radio" name="winLimit" checked=""/><span data-bingo-choice-label="">3人</span>',
    );

    clickEveryAction(counted);
    expect(out.sent).toContainEqual(winLimitMessage(view().config, { Count: 5 }));
  });

  it('builds a fresh game rather than restarting one that is already over', (): void => {
    const out = sink();
    const over = lobby(out, {
      gameIndex: 8,
      view: {
        ...view(),
        phase: 'Finished',
        players: [HOST, ME],
        cards: [],
      },
    });
    const html = renderToString(over);
    expect(html).toContain('>新しいゲームを作る</button>');
    expect(html).not.toContain('>ゲームを開始</button>');
    // Join, Leave, Kick and a host transfer are all refused in a finished game, so none of them is offered.
    expect(html).not.toContain('>参加する</button>');
    expect(html).not.toContain('>参加しない</button>');
    expect(html).not.toContain('data-bingo-menu-toggle');

    clickEveryAction(over);
    // Changing a size is already a new game, so those controls stay; what is gone is everything the engine would refuse.
    expect(out.sent.at(-1)).toEqual(newGameMessage(null));
    expect(out.sent).not.toContainEqual(commandMessage('Start'));
    expect(out.sent).not.toContainEqual(commandMessage('Join'));
    expect(out.sent).not.toContainEqual(commandMessage('Leave'));
    expect(out.sent).not.toContainEqual(kickMessage(ME));
    expect(out.ui).toEqual([]);
  });

  it('gives up both halves rather than scrolling a frame nobody came to read', (): void => {
    const html = renderToString(hostLobby(sink(), IDLE, SLIVER));
    expect(html).toContain('<p data-bingo-pip-title="">3人が待っています</p>');
    expect(html).toContain('<p data-bingo-pip-summary="">5×5 · 自分でタップ · 最後まで · すべて</p>');
    expect(html).toContain('>ゲームを開始</button>');
    expect(html).not.toContain('data-bingo-lobby');
    expect(html).not.toContain('data-bingo-choices');
  });
});

describe('the lobby as a guest', () => {
  it('reads the settings rather than offering them', (): void => {
    const html = renderToString(guestLobby(sink()));
    expect(html).toContain('<div data-bingo-lobby="" data-columns="one" tabindex="0">');
    expect(html).toContain('<h2 data-bingo-label="">設定</h2>');
    expect(html).toContain('<p data-bingo-setting-value="">5×5</p>');
    expect(html).toContain('<p data-bingo-setting-value="">最後まで</p>');
    expect(html).toContain('<p data-bingo-setting-hint="">いつものビンゴ。B-I-N-G-O の5列</p>');
    expect(html).toContain('このアクティビティを開いた人から、ここに並びます');
    expect(html).toContain('ゲーム開始時に公開されます');
    expect(html).toContain('<span data-bingo-hash="">—</span>');
    expect(html).toContain('>参加する</button>');
    expect(html).toContain('<p data-bingo-waiting=""><span aria-hidden="true" data-bingo-waiting-dot=""></span>ホストの開始を待っています</p>');
    expect(html).toContain('data-slot="toast"></div>');
    expect(html).not.toContain('data-bingo-choices');
    expect(html).not.toContain('data-bingo-menu-toggle');
    expect(html).not.toContain('>ゲームを開始</button>');
    expect(html).not.toContain('ゲームを作り直します');
  });

  it('has one seat to take', (): void => {
    const out = sink();
    clickEveryAction(guestLobby(out));
    expect(out.sent).toEqual([commandMessage('Join')]);
    expect(out.ui).toEqual([]);
  });

  it('says how many are waiting when the frame has room for nothing else', (): void => {
    const html = renderToString(
      lobby(sink(), {
        host: false,
        layout: SLIVER,
        me: ME,
        view: {
          ...view(),
          phase: 'Lobby',
          players: [ME],
          cards: [],
        },
      }),
    );
    expect(html).toContain('<p data-bingo-pip-title="">まだあなただけです</p>');
    expect(html).toContain('<p data-bingo-waiting=""><span aria-hidden="true" data-bingo-waiting-dot=""></span>ホストの開始を待っています</p>');
  });
});
