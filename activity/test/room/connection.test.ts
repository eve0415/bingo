import type { OpenTransport, RoomHandlers, RoomState } from '../../app/room/connection';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { ClientMessage, ServerMessage } from '@bingo/wrapper/protocol';

import { describe, expect, it } from 'vitest';

import { connectRoom, initialRoomState, reduceRoom, roomSocketUrl } from '../../app/room/connection';

const PLAYER = {
  issuer: 'discord',
  subject: 'player-1',
};
const SNAPSHOT: ServerMessage = {
  type: 'snapshot',
  view: {
    config: {
      size: 1,
      freeCenter: false,
      patterns: [[0]],
      daub: 'Manual',
      winDetection: 'Claim',
      lateJoin: 'Open',
      winLimit: 'Unlimited',
      cardsPerPlayer: 1,
    },
    phase: 'Lobby',
    host: PLAYER,
    players: [PLAYER],
    drawn: [],
    wins: [],
    cards: [],
    revealedSeed: null,
  },
  room: {
    settings: {
      maxPlayers: 25,
      drawnVisibility: 'Full',
      hostAutoClose: false,
      rosterPersistence: 'KeepAcrossGames',
    },
    roomId: 'room-1',
    gameIndex: 0,
    host: PLAYER,
    commitment: null,
    commitmentConfig: null,
    commitmentRoster: null,
  },
  drawnOrder: [],
};

const joined = (seq: number): EventDto => ({
  PlayerJoined: {
    seq,
    player: PLAYER,
  },
});

class FakeOpenTransport {
  public handlers: RoomHandlers | null = null;
  public sent: string[] = [];
  public closed = false;
  public closes = 0;

  public open: OpenTransport = handlers => {
    this.handlers = handlers;
    return {
      send: data => {
        this.sent.push(data);
      },
      close: () => {
        this.closed = true;
        this.closes += 1;
      },
    };
  };

  public connectedHandlers(): RoomHandlers {
    if (this.handlers === null) throw new Error('the transport has not been opened');
    return this.handlers;
  }
}

describe('room state', () => {
  it('uses snapshots as the current projection and clears an earlier refusal', (): void => {
    const state: RoomState = {
      ...initialRoomState,
      failure: {
        origin: 'room',
        code: 'WrongPhase',
        detail: 'old failure',
      },
    };
    expect(reduceRoom(state, SNAPSHOT)).toEqual({
      ...state,
      view: SNAPSHOT.view,
      room: SNAPSHOT.room,
      drawnOrder: [],
      failure: null,
    });
  });

  it('clears a failure raised by the client when the next frame succeeds', (): void => {
    const state: RoomState = {
      ...initialRoomState,
      failure: {
        origin: 'client',
        code: 'MalformedMessage',
        detail: null,
      },
    };
    expect(reduceRoom(state, SNAPSHOT)).toEqual({
      ...state,
      view: SNAPSHOT.view,
      room: SNAPSHOT.room,
      drawnOrder: [],
      failure: null,
    });
    expect(
      reduceRoom(state, {
        type: 'events',
        events: [],
        drawnOrder: [],
      }),
    ).toEqual({
      ...state,
      failure: null,
    });
  });

  it('records events and retains only the newest fifty', (): void => {
    const state: RoomState = {
      ...initialRoomState,
      log: Array.from({ length: 49 }, (_, index) => joined(index)),
    };
    const message: ServerMessage = {
      type: 'events',
      events: [joined(49), joined(50)],
      drawnOrder: [7, 11],
    };
    const next = reduceRoom(state, message);
    expect(next.drawnOrder).toEqual([7, 11]);
    expect(next.log).toHaveLength(50);
    expect(next.log[0]).toEqual(joined(1));
    expect(next.log[49]).toEqual(joined(50));
  });

  it('retains a room refusal', (): void => {
    const message: ServerMessage = {
      type: 'error',
      code: 'NotHost',
      detail: null,
    };
    expect(reduceRoom(initialRoomState, message)).toEqual({
      ...initialRoomState,
      failure: {
        origin: 'room',
        code: 'NotHost',
        detail: null,
      },
    });
  });
});

describe('room socket urls', () => {
  it('maps page schemes and escapes the room id', (): void => {
    expect(roomSocketUrl('http://localhost:5173', 'room/a b')).toBe('ws://localhost:5173/rooms/room%2Fa%20b/ws');
    expect(roomSocketUrl('https://activity.example', 'room/a b')).toBe('wss://activity.example/rooms/room%2Fa%20b/ws');
  });
});

describe('room connections', () => {
  it('adapts transport events and reports rejected frames', (): void => {
    const fake = new FakeOpenTransport();
    const states: RoomState[] = [];
    const connection = connectRoom(fake.open, state => {
      states.push(state);
    });
    const handlers = fake.connectedHandlers();

    handlers.onOpen();
    expect(states).toHaveLength(1);
    expect(states[0]?.status).toBe('open');

    handlers.onMessage(JSON.stringify(SNAPSHOT));
    expect(states).toHaveLength(2);
    expect(states[1]?.view).toEqual(SNAPSHOT.view);

    handlers.onMessage(JSON.stringify({ type: 'unsupported' }));
    expect(states).toHaveLength(3);
    expect(states[2]?.failure).toEqual({
      origin: 'client',
      code: 'MalformedMessage',
      detail: null,
    });

    handlers.onMessage(JSON.stringify({ type: 'events', events: [], drawnOrder: [] }));
    expect(states).toHaveLength(4);
    expect(states[3]?.failure).toBeNull();

    handlers.onClose(1008, 'token rejected');
    expect(states).toHaveLength(5);
    expect(states[4]).toMatchObject({
      status: 'closed',
      closure: {
        code: 1008,
        reason: 'token rejected',
      },
    });

    connection.close();
    expect(fake.closed).toBe(true);
  });

  it('stops publishing after the caller closes the connection', (): void => {
    const fake = new FakeOpenTransport();
    const states: RoomState[] = [];
    const connection = connectRoom(fake.open, state => {
      states.push(state);
    });
    const handlers = fake.connectedHandlers();

    handlers.onOpen();
    expect(states).toHaveLength(1);

    connection.close();
    handlers.onClose(1000, 'superseded');
    handlers.onMessage(JSON.stringify(SNAPSHOT));
    handlers.onOpen();

    expect(fake.closed).toBe(true);
    expect(states).toHaveLength(1);
  });

  it('reaches the transport no further once the caller has closed it', (): void => {
    const fake = new FakeOpenTransport();
    const states: RoomState[] = [];
    const connection = connectRoom(fake.open, state => {
      states.push(state);
    });
    fake.connectedHandlers().onOpen();

    connection.close();
    connection.send({ type: 'command', command: 'Draw' });
    connection.close();

    expect(fake.sent).toEqual([]);
    expect(fake.closes).toBe(1);
    expect(states).toHaveLength(1);
  });

  it('sends only while the connection is open', (): void => {
    const fake = new FakeOpenTransport();
    const states: RoomState[] = [];
    const connection = connectRoom(fake.open, state => {
      states.push(state);
    });
    const handlers = fake.connectedHandlers();
    const message: ClientMessage = { type: 'command', command: 'Draw' };

    connection.send(message);
    expect(fake.sent).toEqual([]);
    expect(states[0]).toMatchObject({
      status: 'connecting',
      failure: {
        origin: 'client',
        code: 'NotConnected',
        detail: null,
      },
    });

    handlers.onOpen();
    connection.send(message);
    expect(fake.sent).toEqual(['{"type":"command","command":"Draw"}']);

    handlers.onClose(1000, 'finished');
    connection.send(message);
    expect(fake.sent).toEqual(['{"type":"command","command":"Draw"}']);
    expect(states[3]).toMatchObject({
      status: 'closed',
      failure: {
        origin: 'client',
        code: 'NotConnected',
        detail: null,
      },
    });
  });
});
