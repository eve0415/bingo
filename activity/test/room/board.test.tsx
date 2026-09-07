import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Board } from '../../app/room/board';

import { HOST, IDLE, ME, PROFILES, clickEveryAction, committedRoom, room, sink, state, view } from './fixture';

const DESK = {
  width: 1200,
  height: 800,
};
const PHONE = {
  width: 390,
  height: 844,
};
describe('the board before the first snapshot', () => {
  it('counts the launch to its last step while the socket opens', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          status: 'connecting',
          view: null,
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('<p data-bingo-body="">部屋につないでいます。</p>');
    expect(html).toContain('<p aria-hidden="true" data-bingo-launch-count="">5 / 5</p>');
    // Four waits are behind it and the fifth is the one in flight, which is what the strip has to show.
    expect(html.match(/data-state="marked"/gu)).toHaveLength(4);
    expect(html.match(/data-state="pending"/gu)).toHaveLength(1);
    // Opening a socket is what the launch already says; it must not be repeated as a notice.
    expect(html).not.toContain('接続しています');
  });

  it('keeps naming the wait when the socket is open and the snapshot has not arrived', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          view: null,
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('<p data-bingo-body="">部屋につないでいます。</p>');
    expect(html).toContain('data-bingo-launch-strip');
  });

  it('stops counting when the room refused the join rather than showing a launch still in flight', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          status: 'closed',
          view: null,
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('<p data-bingo-note-title="">参加できませんでした</p>');
    expect(html).toContain('接続が切れました。アクティビティを開き直してください');
    // Nothing on a terminal screen may go on implying the launch is still moving.
    expect(html).not.toContain('部屋につないでいます。');
    expect(html).not.toContain('data-bingo-launch-strip');
    expect(html).not.toContain('data-bingo-launch-sweep');
  });
});

describe('the board at the end of a game', () => {
  it('shows the result of a game somebody won', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          view: {
            ...view(),
            phase: 'Finished',
            wins: [
              {
                winners: [ME],
                patterns: [[0, 1, 2, 3, 4]],
                atSeq: 9,
                rank: 1,
              },
            ],
          },
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('<h2 data-bingo-result-title="">ビンゴ</h2>');
  });

  it('shows the result of a game that was played and won by nobody', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          drawnOrder: [7],
          view: {
            ...view(),
            phase: 'Finished',
          },
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('<h2 data-bingo-result-title="">ビンゴは出ませんでした</h2>');
  });

  it('returns to the lobby for a finished game that was never played', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          drawnOrder: [],
          room: committedRoom(),
          view: {
            ...view(),
            phase: 'Finished',
          },
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('コミットメント');
    expect(html).toContain(`${'a'.repeat(16)} ${'b'.repeat(16)} cc`);
    expect(html).toContain('ゲーム 7 の開始時に公開');
    expect(html).not.toContain('data-bingo-result');
  });
});

describe('the board in the lobby', () => {
  it('opens the lobby with nothing committed while the room is still unknown', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={DESK}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          room: null,
          view: {
            ...view(),
            phase: 'Lobby',
          },
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('<span data-bingo-hash="">—</span>');
    expect(html).toContain('ゲーム開始時に公開されます');
  });
});

describe('the board during a running game', () => {
  it('gives the caller the flashboard', (): void => {
    const html = renderToString(
      <Board me={HOST} measure={DESK} profiles={PROFILES} onCommand={(): void => undefined} onUi={(): void => undefined} state={state()} ui={IDLE} />,
    );
    expect(html).toContain('data-bingo-flash=""');
    expect(html).toContain('>ゲームを終了</button>');
  });

  it('gives a player the card, and routes the roster through the shell state', (): void => {
    const out = sink();
    const board = (
      <Board
        me={ME}
        measure={PHONE}
        profiles={PROFILES}
        onCommand={(message): void => {
          out.sent.push(message);
        }}
        onUi={(action): void => {
          out.ui.push(action);
        }}
        state={state()}
        ui={IDLE}
      />
    );
    const html = renderToString(board);
    expect(html).toContain('data-bingo-play=""');
    expect(html).toContain('data-bingo-call=""');
    expect(html).toContain('>ビンゴを宣言</button>');
    expect(html).not.toContain('data-bingo-flash');

    clickEveryAction(board);
    expect(out.ui).toEqual([
      {
        type: 'open',
        overlay: {
          kind: 'roster',
        },
      },
    ]);
    expect(out.sent).toHaveLength(25);
  });

  it('drops the call box and the claim while the room is hiding the draw', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={PHONE}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          status: 'closed',
          room: {
            ...room(),
            settings: {
              ...room().settings,
              drawnVisibility: 'Hidden',
            },
          },
          view: {
            ...view(),
            config: {
              ...view().config,
              winDetection: 'Auto',
            },
          },
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('番号は非公開です。カードだけを見て遊びます');
    expect(html).toContain('<span data-bingo-status="">· <!-- -->接続が切れました</span>');
    expect(html).toContain('接続が切れました。アクティビティを開き直してください');
    expect(html).not.toContain('>ビンゴを宣言</button>');
  });

  it('keeps the claim off a screen with no card to claim on', (): void => {
    const html = renderToString(
      <Board
        me={ME}
        measure={PHONE}
        profiles={PROFILES}
        onCommand={(): void => undefined}
        onUi={(): void => undefined}
        state={{
          ...state(),
          view: {
            ...view(),
            cards: [],
          },
        }}
        ui={IDLE}
      />,
    );
    expect(html).toContain('観戦中');
    expect(html).not.toContain('>ビンゴを宣言</button>');
  });
});
