import { describe, expect, it } from 'vitest';

import { parseServerMessage } from '../../app/room/messages';

const PLAYER_ONE = {
  issuer: 'discord',
  subject: 'player-1',
};
const PLAYER_TWO = {
  issuer: 'discord',
  subject: 'player-2',
};
const CONFIG = {
  size: 5,
  freeCenter: true,
  patterns: [
    [0, 1, 2, 3, 4],
    [0, 6, 12, 18, 24],
  ],
  daub: 'Manual',
  winDetection: 'Claim',
  lateJoin: 'Open',
  winLimit: 'Unlimited',
  cardsPerPlayer: 1,
};
const SETTINGS = {
  maxPlayers: 25,
  drawnVisibility: 'Full',
  hostAutoClose: false,
  rosterPersistence: 'KeepAcrossGames',
};
const RECOGNIZED_WIN = {
  winners: [PLAYER_ONE],
  patterns: [[0, 1, 2, 3, 4]],
  atSeq: 12,
  rank: 1,
};
const CARD = {
  owner: PLAYER_ONE,
  cardIx: 0,
  cells: [1, 16, 31, 46, 61, 2, 17, 32, 47, 62, 3, 18, 0, 48, 63, 4, 19, 34, 49, 64, 5, 20, 35, 50, 65],
  marked: [0, 1, 2, 3, 4],
  bingo: [[0, 1, 2, 3, 4]],
  reach: [[5, 6, 7, 8, 9]],
};

type MessageFixture = Record<string, unknown>;

const view = (phase: 'Lobby' | 'Running' | 'Finished', revealedSeed: string | null = null): MessageFixture => ({
  config: CONFIG,
  phase,
  host: PLAYER_ONE,
  players: [PLAYER_ONE, PLAYER_TWO],
  drawn: [1, 16, 31, 46, 61],
  wins: [RECOGNIZED_WIN],
  cards: [CARD],
  revealedSeed,
});

const uncommittedRoom = (): MessageFixture => ({
  settings: SETTINGS,
  roomId: 'i-1-gc-2-3',
  gameIndex: 0,
  host: PLAYER_ONE,
  commitment: null,
  commitmentConfig: null,
  commitmentRoster: null,
});

const uncommittedSnapshot = (): MessageFixture => ({
  type: 'snapshot',
  view: view('Running'),
  room: uncommittedRoom(),
  drawnOrder: [1, 16, 31, 46, 61],
});

const committedSnapshot = (phase: 'Lobby' | 'Finished' = 'Lobby'): MessageFixture => ({
  type: 'snapshot',
  view: view(phase, phase === 'Finished' ? '0123456789abcdef' : null),
  room: {
    settings: SETTINGS,
    roomId: 'i-1-gc-2-3',
    gameIndex: 1,
    host: PLAYER_ONE,
    commitment: 'abcdef0123456789',
    commitmentConfig: CONFIG,
    commitmentRoster: [PLAYER_ONE, PLAYER_TWO],
  },
  drawnOrder: [42],
});

const eventsFrame = (): MessageFixture => ({
  type: 'events',
  events: [
    {
      PlayerJoined: {
        seq: 1,
        player: PLAYER_ONE,
      },
    },
    {
      PlayerLeft: {
        seq: 2,
        player: PLAYER_TWO,
      },
    },
    {
      MarkPlaced: {
        seq: 3,
        player: PLAYER_ONE,
        cardIx: 0,
        row: 0,
        col: 0,
      },
    },
    {
      MarkRemoved: {
        seq: 4,
        player: PLAYER_ONE,
        cardIx: 0,
        row: 0,
        col: 0,
      },
    },
    {
      BingoClaimed: {
        seq: 5,
        player: PLAYER_ONE,
        cardIx: 0,
      },
    },
    {
      GameStarted: {
        seq: 6,
        actor: PLAYER_ONE,
      },
    },
    {
      NumberDrawn: {
        seq: 7,
        actor: PLAYER_ONE,
        number: 42,
      },
    },
    {
      DrawUndone: {
        seq: 8,
        actor: PLAYER_ONE,
        number: 42,
        revoked: [
          {
            player: PLAYER_TWO,
            cardIx: 0,
            row: 2,
            col: 2,
          },
        ],
      },
    },
    {
      PlayerKicked: {
        seq: 9,
        actor: PLAYER_ONE,
        target: PLAYER_TWO,
      },
    },
    {
      HostTransferred: {
        seq: 10,
        actor: PLAYER_ONE,
        target: PLAYER_TWO,
      },
    },
    {
      GameClosed: {
        seq: 11,
        actor: PLAYER_ONE,
      },
    },
    {
      WinRecognized: {
        seq: 12,
        ...RECOGNIZED_WIN,
      },
    },
  ],
  drawnOrder: [42],
});

const encoded = (value: unknown): string => JSON.stringify(value);
const parsed = async (raw: string): Promise<unknown> => {
  const frame = await Promise.resolve(raw);
  return parseServerMessage(frame);
};

describe('parsing room server messages', () => {
  it('accepts snapshots before and after the room publishes its commitment', async (): Promise<void> => {
    const beforeCommitment = uncommittedSnapshot();
    const afterCommitment = committedSnapshot();
    expect(await parsed(encoded(beforeCommitment))).toEqual(beforeCommitment);
    expect(await parsed(encoded(afterCommitment))).toEqual(afterCommitment);
    const finished = committedSnapshot('Finished');
    expect(await parsed(encoded(finished))).toEqual(finished);
  });

  it('accepts every event shape in one events frame', async (): Promise<void> => {
    const message = eventsFrame();
    expect(await parsed(encoded(message))).toEqual(message);
  });

  it('accepts an error frame', async (): Promise<void> => {
    const message = {
      type: 'error',
      code: 'WrongPhase',
      detail: null,
    };
    expect(await parsed(encoded(message))).toEqual(message);
  });

  it('ignores fields added to snapshots by a newer wrapper', async (): Promise<void> => {
    const current = uncommittedSnapshot();
    const message = {
      ...current,
      view: {
        ...view('Running'),
        futureViewField: true,
      },
      room: {
        ...uncommittedRoom(),
        futureRoomField: true,
      },
      futureSnapshotField: true,
    };
    expect(await parsed(encoded(message))).toEqual(current);
  });

  it('ignores a field added inside the room config by a newer wrapper', async (): Promise<void> => {
    const current = uncommittedSnapshot();
    const message = {
      ...current,
      view: {
        ...view('Running'),
        config: {
          ...CONFIG,
          futureConfigField: true,
        },
      },
    };
    expect(await parsed(encoded(message))).toEqual(current);
  });

  it('ignores a field added inside the room settings by a newer wrapper', async (): Promise<void> => {
    const current = uncommittedSnapshot();
    const message = {
      ...current,
      room: {
        ...uncommittedRoom(),
        settings: {
          ...SETTINGS,
          futureSettingsField: true,
        },
      },
    };
    expect(await parsed(encoded(message))).toEqual(current);
  });

  it('ignores a field added inside a player id by a newer wrapper', async (): Promise<void> => {
    const current = uncommittedSnapshot();
    const message = {
      ...current,
      view: {
        ...view('Running'),
        players: [
          {
            ...PLAYER_ONE,
            futurePlayerField: true,
          },
          PLAYER_TWO,
        ],
      },
    };
    expect(await parsed(encoded(message))).toEqual(current);
  });

  it('ignores fields added to events by a newer wrapper', async (): Promise<void> => {
    const message = {
      type: 'events',
      events: [
        {
          PlayerJoined: {
            seq: 1,
            player: PLAYER_ONE,
            futureEventField: true,
          },
          futureEnvelopeField: true,
        },
      ],
      drawnOrder: [],
      futureFrameField: true,
    };
    expect(await parsed(encoded(message))).toEqual({
      type: 'events',
      events: [
        {
          PlayerJoined: {
            seq: 1,
            player: PLAYER_ONE,
          },
        },
      ],
      drawnOrder: [],
    });
  });

  it('rejects malformed JSON', async (): Promise<void> => {
    expect(await parsed('{')).toBeNull();
  });

  it('rejects a message type this client does not understand', async (): Promise<void> => {
    expect(await parsed(encoded({ type: 'gameLog', events: [] }))).toBeNull();
  });

  it('rejects a known message whose payload violates its schema', async (): Promise<void> => {
    const message = {
      ...uncommittedSnapshot(),
      drawnOrder: ['not-a-number'],
    };
    expect(await parsed(encoded(message))).toBeNull();
  });
});
