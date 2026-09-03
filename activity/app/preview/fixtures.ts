import type { RoomState } from '../room/connection';
import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { PhaseDto } from '@bingo/wasm/PhaseDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { DrawnVisibility } from '@bingo/wrapper/settings';

import { playerKey } from '@bingo/wrapper/identity';
import { DEFAULT_SETTINGS } from '@bingo/wrapper/settings';

import { initialRoomState } from '../room/connection';

const HOST: PlayerIdDto = {
  issuer: 'discord',
  subject: '1000',
};
const ME: PlayerIdDto = {
  issuer: 'discord',
  subject: '2000',
};
const OTHERS: PlayerIdDto[] = [3000, 4000, 5000, 6000].map(subject => ({
  issuer: 'discord',
  subject: String(subject),
}));

export const NAMES = new Map(
  [HOST, ME, ...OTHERS].map((player, index) => [playerKey(player), ['ゆうき', 'さくら', 'Tomás', 'けんた', 'Ana', 'みなと'][index]]),
);

export const SIZES = [3, 5, 7, 9];

/** A printed card draws each column from its own run of fifteen numbers; the centre is left at zero when it is free. */
const cellsFor = (size: number, offset: number): number[] =>
  Array.from({ length: size * size }, (_unused, index) => {
    const column = index % size;
    const row = Math.floor(index / size);
    const middle = Math.floor(size / 2);
    return row === middle && column === middle ? 0 : column * 15 + ((row * 7 + offset) % 15) + 1;
  });

/** A stride coprime with the pool, so the sample draw never repeats a number the way a shared factor would. */
const drawnFor = (size: number): number[] => Array.from({ length: 23 }, (_unused, index) => ((index * 23) % (size * 15)) + 1);

const config = (size: number): ConfigDto => ({
  size,
  freeCenter: true,
  patterns: [],
  daub: 'Auto',
  winDetection: 'Auto',
  lateJoin: 'Open',
  winLimit: 'Unlimited',
  cardsPerPlayer: 1,
});

const cardFor = (owner: PlayerIdDto, size: number, offset: number, marked: number[], bingo: number[][], reach: number[][]): CardViewDto => ({
  owner,
  cardIx: 0,
  cells: cellsFor(size, offset),
  marked,
  bingo,
  reach,
});

const column = (size: number): number[] => Array.from({ length: size }, (_unused, row) => row * size);
const middleRow = (size: number): number[] => Array.from({ length: size }, (_unused, index) => Math.floor(size / 2) * size + index);

const state = (size: number, phase: PhaseDto, overrides: Partial<ConfigDto>, extras: Partial<RoomState>, visibility: DrawnVisibility = 'Full'): RoomState => {
  const drawn = phase === 'Lobby' || visibility === 'Hidden' ? [] : drawnFor(size);
  const centre = Math.floor(size / 2) * size + Math.floor(size / 2);
  const mine = cardFor(ME, size, 0, [centre, ...column(size).slice(0, size - 1)], [], [column(size)]);
  const winner = cardFor(HOST, size, 7, [centre, ...middleRow(size)], [middleRow(size)], []);
  return {
    ...initialRoomState,
    status: 'open',
    drawnOrder: drawn,
    view: {
      config: {
        ...config(size),
        ...overrides,
      },
      phase,
      host: HOST,
      players: [HOST, ME, ...OTHERS],
      drawn,
      wins: phase === 'Finished' ? [{ winners: [HOST, OTHERS[0]], patterns: [middleRow(size)], atSeq: 40, rank: 1 }] : [],
      cards: [mine, winner, ...OTHERS.map((owner, index) => cardFor(owner, size, 11 * (index + 1), [centre], [], []))],
      revealedSeed: phase === 'Finished' ? 'a3f1c07d5b2e49a8c6d0f31b7e845290a3f1c07d5b2e49a8c6d0f31b7e845290' : null,
    },
    room: {
      settings: {
        ...DEFAULT_SETTINGS,
        drawnVisibility: visibility,
      },
      roomId: 'preview',
      gameIndex: 1,
      host: HOST,
      commitment: null,
      commitmentConfig: null,
      commitmentRoster: null,
    },
    ...extras,
  };
};

export const SCENES = {
  lobby: (size: number) => ({
    me: HOST,
    state: state(size, 'Lobby', {}, {}),
  }),
  player: (size: number) => ({
    me: ME,
    state: state(size, 'Running', {}, {}),
  }),
  'player-manual': (size: number) => ({
    me: ME,
    state: state(size, 'Running', { daub: 'Manual' }, { pending: [{ cardIx: 0, row: 1, col: 1 }] }),
  }),
  'player-hidden': (size: number) => ({
    me: ME,
    state: state(size, 'Running', {}, {}, 'Hidden'),
  }),
  'player-offline': (size: number) => ({
    me: ME,
    state: state(size, 'Running', {}, { status: 'closed' }),
  }),
  host: (size: number) => ({
    me: HOST,
    state: state(size, 'Running', {}, {}),
  }),
  win: (size: number) => ({
    me: ME,
    state: state(size, 'Finished', {}, {}),
  }),
} as const;

export type Scene = keyof typeof SCENES;

export const isScene = (value: string): value is Scene => Object.hasOwn(SCENES, value);
