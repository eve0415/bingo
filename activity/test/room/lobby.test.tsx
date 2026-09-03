import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { commandMessage, daubMessage, kickMessage, newGameMessage, settingsMessage, sizeMessage, winLimitMessage } from '../../app/room/commands';
import { Lobby } from '../../app/room/lobby';

import { HOST, ME, NAMES, OTHER, clickEveryAction, committedRoom, config, view } from './fixture';

const hostLobby = (sent: ClientMessage[]): JSX.Element => (
  <Lobby
    commitment={committedRoom().commitment}
    gameIndex={7}
    host
    me={HOST}
    names={NAMES}
    notice="この操作はホストだけができます"
    onSend={(message): void => {
      sent.push(message);
    }}
    view={{
      ...view(),
      phase: 'Lobby',
      players: [HOST, ME, OTHER],
      cards: [],
    }}
    columns="split"
    dense={false}
    visibility="Full"
  />
);

const guestLobby = (sent: ClientMessage[]): JSX.Element => (
  <Lobby
    commitment={null}
    gameIndex={0}
    host={false}
    me={ME}
    names={NAMES}
    notice={null}
    onSend={(message): void => {
      sent.push(message);
    }}
    view={{
      ...view(),
      phase: 'Lobby',
      players: [OTHER],
      cards: [],
    }}
    columns="one"
    dense
    visibility="Full"
  />
);

describe('the lobby as the host', () => {
  it('offers the settings as controls beside the roster', (): void => {
    const html = renderToString(hostLobby([]));
    expect(html).toContain('<div data-bingo-columns="" data-columns="split">');
    expect(html).toContain('data-dense="false"');
    expect(html).toContain('待機中');
    expect(html).toContain('<h2 data-bingo-label="">次のゲームの設定</h2>');
    expect(html).toContain('カードの設定を変えるとゲームを作り直します。退出させた人も入り直せるようになります。');
    expect(html).toContain('<p data-bingo-body="">5×5 · 自分でタップ · 番号をすべて表示 · 最後まで続ける</p>');
    expect(html).toContain('<div aria-label="終わり方" data-bingo-options="" role="group">');
    expect(html).toContain(
      'aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">最後まで続ける</button>',
    );
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="secondary" type="button">1人で終了</button>',
    );
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="secondary" type="button">3人で終了</button>',
    );
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="secondary" type="button">5人で終了</button>',
    );
    expect(html).toContain('aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">5×5</button>');
    expect(html).toContain('>3×3</button>');
    expect(html).toContain('>自動でマーク</button>');
    expect(html).toContain('>最新の番号だけ</button>');
    expect(html).toContain(`${'a'.repeat(16)} ${'b'.repeat(16)} cc`);
    expect(html).toContain('ゲーム 7 の開始時に公開');
    expect(html).toContain('参加者 · <!-- -->3<!-- -->人');
    expect(html).toContain('aria-label="🎲ぼくを退出させる"');
    expect(html).toContain('aria-label="プレイヤー 0003を退出させる"');
    expect(html).toContain('>参加しない</button>');
    expect(html).not.toContain('>退出する</button>');
    expect(html).toContain('>ゲームを開始</button>');
    expect(html).toContain('<span data-bingo-toast="">');
    expect(html).toContain('この操作はホストだけができます');
    expect(html).not.toContain('新しいゲームを作る');
    expect(html).not.toContain('まだあなただけです');
    expect(html).not.toContain('disabled=""');
  });

  it('sends exactly the message each control stands for', (): void => {
    const sent: ClientMessage[] = [];
    clickEveryAction(hostLobby(sent));
    expect(sent).toEqual([
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
      kickMessage(ME),
      kickMessage(OTHER),
      commandMessage('Leave'),
      commandMessage('Start'),
    ]);
  });

  it('marks a counted limit as the chosen one, though the room and the control never share an object', (): void => {
    const sent: ClientMessage[] = [];
    const lobby = (
      <Lobby
        columns="one"
        commitment={null}
        dense={false}
        gameIndex={2}
        host
        me={HOST}
        names={NAMES}
        notice={null}
        onSend={(message): void => {
          sent.push(message);
        }}
        view={{
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
        }}
        visibility="Full"
      />
    );
    const html = renderToString(lobby);
    expect(html).toContain('· 3人で終了</p>');
    expect(html).toContain(
      'aria-pressed="true" data-bingo-button="" data-block="false" data-size="md" data-variant="primary" type="button">3人で終了</button>',
    );
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="secondary" type="button">最後まで続ける</button>',
    );
    expect(html).toContain(
      'aria-pressed="false" data-bingo-button="" data-block="false" data-size="md" data-variant="secondary" type="button">5人で終了</button>',
    );

    clickEveryAction(lobby);
    expect(sent).toContainEqual(winLimitMessage(view().config, { Count: 5 }));
  });

  it('builds a fresh game rather than restarting one that is already over', (): void => {
    const sent: ClientMessage[] = [];
    const lobby = (
      <Lobby
        commitment={null}
        gameIndex={8}
        host
        me={HOST}
        names={NAMES}
        notice={null}
        onSend={(message): void => {
          sent.push(message);
        }}
        view={{
          ...view(),
          phase: 'Finished',
          players: [HOST, ME],
          cards: [],
        }}
        columns="one"
        dense={false}
        visibility="Full"
      />
    );
    const html = renderToString(lobby);
    expect(html).toContain('>新しいゲームを作る</button>');
    expect(html).not.toContain('>ゲームを開始</button>');
    // Join is refused in a finished game, so the seat toggle is not offered at all.
    expect(html).not.toContain('>参加する</button>');
    expect(html).not.toContain('>参加しない</button>');

    clickEveryAction(lobby);
    expect(sent.at(-1)).toEqual(newGameMessage(null));
    expect(sent).not.toContainEqual(commandMessage('Start'));
    expect(sent).not.toContainEqual(commandMessage('Join'));
    expect(sent).not.toContainEqual(commandMessage('Leave'));
  });

  it('cannot start a game nobody has joined', (): void => {
    const html = renderToString(
      <Lobby
        commitment={null}
        gameIndex={0}
        host
        me={HOST}
        names={NAMES}
        notice={null}
        onSend={(): void => undefined}
        view={{
          ...view(),
          phase: 'Lobby',
          players: [],
          cards: [],
        }}
        columns="one"
        dense={false}
        visibility="Hidden"
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain('参加者 · <!-- -->0<!-- -->人');
    expect(html).toContain('番号を隠す');
  });
});

describe('the lobby as a guest', () => {
  it('reads the settings rather than offering them', (): void => {
    const html = renderToString(guestLobby([]));
    expect(html).toContain('<div data-bingo-columns="" data-columns="one">');
    expect(html).toContain('data-dense="true"');
    expect(html).toContain('<h2 data-bingo-label="">設定</h2>');
    expect(html).toContain('まだあなただけです');
    expect(html).toContain('ゲーム開始時に公開されます');
    expect(html).toContain('<p data-bingo-hash="">—</p>');
    expect(html).toContain('>参加する</button>');
    expect(html).toContain('data-slot="toast"></div>');
    expect(html).not.toContain('>3×3</button>');
    expect(html).not.toContain('>ゲームを開始</button>');
    expect(html).not.toContain('を退出させる');
    expect(html).not.toContain('ゲームを作り直します');
  });

  it('has one seat to take', (): void => {
    const sent: ClientMessage[] = [];
    clickEveryAction(guestLobby(sent));
    expect(sent).toEqual([commandMessage('Join')]);
  });
});
