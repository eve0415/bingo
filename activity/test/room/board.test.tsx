import type { RoomState } from '../../app/room/connection';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { ReactNode } from 'react';

import { Children, isValidElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Board } from '../../app/room/board';
import { cellMessage, claimMessage, commandMessage, newGameMessage } from '../../app/room/commands';
import { initialRoomState } from '../../app/room/connection';

const HOST: PlayerIdDto = {
  issuer: 'discord',
  subject: 'host',
};
const ME: PlayerIdDto = {
  issuer: 'discord',
  subject: 'me',
};
const EVENT_LOG: EventDto[] = [
  { PlayerJoined: { seq: 1, player: ME } },
  { PlayerLeft: { seq: 2, player: ME } },
  { MarkPlaced: { seq: 3, player: ME, cardIx: 3, row: 0, col: 0 } },
  { MarkRemoved: { seq: 4, player: ME, cardIx: 3, row: 0, col: 0 } },
  { BingoClaimed: { seq: 5, player: ME, cardIx: 3 } },
  { GameStarted: { seq: 6, actor: HOST } },
  { NumberDrawn: { seq: 7, actor: HOST, number: 7 } },
  { DrawUndone: { seq: 8, actor: HOST, number: 7, revoked: [] } },
  { PlayerKicked: { seq: 9, actor: HOST, target: ME } },
  { HostTransferred: { seq: 10, actor: HOST, target: ME } },
  { GameClosed: { seq: 11, actor: HOST } },
  { WinRecognized: { seq: 12, winners: [ME], patterns: [[0, 1]], atSeq: 12, rank: 1 } },
];

const roomState = (): RoomState => ({
  status: 'open',
  view: {
    config: {
      size: 2,
      freeCenter: false,
      patterns: [[0, 1]],
      daub: 'Manual',
      winDetection: 'Claim',
      lateJoin: 'Open',
      winLimit: 'Unlimited',
      cardsPerPlayer: 1,
    },
    phase: 'Running',
    host: HOST,
    players: [HOST, ME],
    drawn: [7, 8],
    wins: [
      {
        winners: [HOST, ME],
        patterns: [[0, 1]],
        atSeq: 12,
        rank: 1,
      },
    ],
    cards: [
      {
        owner: ME,
        cardIx: 3,
        cells: [7, 8, 9, 10],
        marked: [0, 3],
        bingo: [],
        reach: [[0, 1]],
      },
      {
        owner: HOST,
        cardIx: 3,
        cells: [11, 12, 13, 14],
        marked: [1],
        bingo: [],
        reach: [],
      },
    ],
    revealedSeed: null,
  },
  room: {
    settings: {
      maxPlayers: 25,
      drawnVisibility: 'Full',
      hostAutoClose: false,
      rosterPersistence: 'KeepAcrossGames',
    },
    roomId: 'discord-room-1',
    gameIndex: 4,
    host: HOST,
    commitment: null,
    commitmentConfig: null,
    commitmentRoster: null,
  },
  drawnOrder: [7, 8],
  log: EVENT_LOG,
  failure: null,
  closure: null,
});

const render = (state: RoomState): string => {
  const commands: ClientMessage[] = [];
  return renderToString(
    <Board
      me={ME}
      onCommand={(message): void => {
        commands.push(message);
      }}
      state={state}
    />,
  );
};

interface InteractiveProps {
  children?: ReactNode;
  onClick?: () => void;
}

const clickEveryAction = (node: ReactNode): void => {
  Children.forEach(node, child => {
    if (!isValidElement<InteractiveProps>(child)) return;
    child.props.onClick?.();
    clickEveryAction(child.props.children);
  });
};

describe('the room board', () => {
  it('renders a complete room projection including simultaneous winners', (): void => {
    const html = render(roomState());
    expect(html).toContain('<strong>open</strong>');
    expect(html).toContain('discord-room-1');
    expect(html).toContain('Game index');
    expect(html).toContain('Running');
    expect(html).toContain('discord:host<!-- --> (host)');
    expect(html).toContain('discord:me<!-- --> (you)');
    expect(html).toContain('<strong>8<!-- --> (latest)</strong>');
    expect(html).toContain('aria-label="Unmark 7" aria-pressed="true"');
    expect(html).toContain('aria-label="Mark 8" aria-pressed="false"');
    expect(html).toContain('<mark>7</mark>');
    expect(html).toContain('Card <!-- -->3<!-- --> for <!-- -->discord:me');
    expect(html).toContain('Card <!-- -->3<!-- --> for <!-- -->discord:host');
    expect(html).toContain('<mark>12</mark>');
    expect(html).not.toContain('aria-label="Mark 11"');
    expect(html).not.toContain('aria-label="Unmark 12"');
    expect(html.match(/>Claim<\/button>/gu)).toHaveLength(1);
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Rank <!-- -->1<!-- --> at sequence <!-- -->12<!-- -->: <!-- -->discord:host, discord:me');
    for (const [index, name] of [
      'PlayerJoined',
      'PlayerLeft',
      'MarkPlaced',
      'MarkRemoved',
      'BingoClaimed',
      'GameStarted',
      'NumberDrawn',
      'DrawUndone',
      'PlayerKicked',
      'HostTransferred',
      'GameClosed',
      'WinRecognized',
    ].entries()) {
      expect(html).toContain(`${name}<!-- --> at sequence <!-- -->${index + 1}`);
    }
    for (const label of ['Claim', 'Join', 'Leave', 'Start', 'Draw', 'Undo', 'Close', 'New game']) expect(html).toContain(`>${label}</button>`);
  });

  it('disables owned card actions and room controls until the connection opens', (): void => {
    const html = render({
      ...roomState(),
      status: 'connecting',
    });
    expect(html).toContain('aria-pressed="true" disabled=""');
    expect(html).toContain('<button disabled="" type="button">Join</button>');
    expect(html.match(/disabled=""/gu)).toHaveLength(12);
  });

  it('renders closure and refusal details while waiting for a snapshot', (): void => {
    const html = render({
      ...initialRoomState,
      status: 'closed',
      failure: {
        origin: 'room',
        code: 'NotHost',
        detail: null,
      },
      closure: {
        code: 1008,
        reason: 'room token rejected',
      },
    });
    expect(html).toContain('Socket closed with code <!-- -->1008<!-- -->: <!-- -->room token rejected');
    expect(html).toContain('Room-reported failure');
    expect(html).toContain('<code>NotHost</code>');
    expect(html).toContain('detail: <!-- -->none');
    expect(html).toContain('Room details are not available yet.');
    expect(html).toContain('Waiting for the first room snapshot…');
  });

  it('renders the detail attached to a room refusal', (): void => {
    const html = render({
      ...roomState(),
      failure: {
        origin: 'room',
        code: 'WrongPhase',
        detail: 'the game is still in the lobby',
      },
    });
    expect(html).toContain('the game is still in the lobby');
  });

  it('labels a failure raised by the client', (): void => {
    const html = render({
      ...roomState(),
      failure: {
        origin: 'client',
        code: 'MalformedMessage',
        detail: null,
      },
    });
    expect(html).toContain('Client failure');
  });

  it('dispatches each action through its rendered handler', (): void => {
    const commands: ClientMessage[] = [];
    const renderBoard = Board;
    clickEveryAction(
      renderBoard({
        me: ME,
        onCommand: message => {
          commands.push(message);
        },
        state: roomState(),
      }),
    );
    expect(commands).toEqual([
      cellMessage(3, 0, 2, true),
      cellMessage(3, 1, 2, false),
      cellMessage(3, 2, 2, false),
      cellMessage(3, 3, 2, true),
      claimMessage(3),
      commandMessage('Join'),
      commandMessage('Leave'),
      commandMessage('Start'),
      commandMessage('Draw'),
      commandMessage('Undo'),
      commandMessage('Close'),
      newGameMessage(),
    ]);
  });
});

describe('board commands', () => {
  it('builds every always-visible control message', (): void => {
    expect([
      commandMessage('Join'),
      commandMessage('Leave'),
      commandMessage('Start'),
      commandMessage('Draw'),
      commandMessage('Undo'),
      commandMessage('Close'),
    ]).toEqual([
      { type: 'command', command: 'Join' },
      { type: 'command', command: 'Leave' },
      { type: 'command', command: 'Start' },
      { type: 'command', command: 'Draw' },
      { type: 'command', command: 'Undo' },
      { type: 'command', command: 'Close' },
    ]);
    expect(newGameMessage()).toEqual({ type: 'newGame', config: null });
  });

  it('turns card positions into mark, unmark, and claim messages', (): void => {
    expect(cellMessage(3, 5, 4, false)).toEqual({
      type: 'command',
      command: {
        Mark: {
          cardIx: 3,
          row: 1,
          col: 1,
        },
      },
    });
    expect(cellMessage(3, 6, 4, true)).toEqual({
      type: 'command',
      command: {
        Unmark: {
          cardIx: 3,
          row: 1,
          col: 2,
        },
      },
    });
    expect(claimMessage(3)).toEqual({
      type: 'command',
      command: {
        Claim: {
          cardIx: 3,
        },
      },
    });
  });
});
