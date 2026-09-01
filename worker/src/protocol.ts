import type { RoomSettings } from './settings';
import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { HostViewDto } from '@bingo/wasm/HostViewDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { PlayerViewDto } from '@bingo/wasm/PlayerViewDto';
import type { InferOutput } from 'valibot';

import { array, boolean, literal, number, picklist, strictObject, union, unknown, variant } from 'valibot';

import { playerIdSchema } from './identity';
import { roomSettingsUpdateSchema } from './settings';

const numberSchema = number();
const patternSchema = array(numberSchema);
const positionSchema = strictObject({
  cardIx: numberSchema,
  row: numberSchema,
  col: numberSchema,
});
const cardSchema = strictObject({
  cardIx: numberSchema,
});
const targetSchema = strictObject({
  target: playerIdSchema,
});

export const configSchema = strictObject({
  size: numberSchema,
  freeCenter: boolean(),
  patterns: array(patternSchema),
  daub: picklist(['Auto', 'Manual']),
  winDetection: picklist(['Auto', 'Claim']),
  lateJoin: picklist(['Closed', 'OpenNoBacklog', 'Open']),
  winLimit: union([
    literal('FirstOnly'),
    strictObject({
      Count: numberSchema,
    }),
    literal('Unlimited'),
  ]),
  cardsPerPlayer: numberSchema,
});

export const commandSchema = union([
  picklist(['Join', 'Leave', 'Start', 'Draw', 'Undo', 'Close']),
  strictObject({
    Mark: positionSchema,
  }),
  strictObject({
    Unmark: positionSchema,
  }),
  strictObject({
    Claim: cardSchema,
  }),
  strictObject({
    Kick: targetSchema,
  }),
  strictObject({
    TransferHost: targetSchema,
  }),
]);

export const clientMessageEnvelopeSchema = variant('type', [
  strictObject({
    type: literal('command'),
    command: unknown(),
  }),
  strictObject({
    type: literal('newGame'),
    config: unknown(),
  }),
  strictObject({
    type: literal('settings'),
    settings: roomSettingsUpdateSchema,
  }),
  strictObject({
    type: literal('resync'),
  }),
]);

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;
export type GeneratedSchemaAssertions = [
  Assert<Equal<InferOutput<typeof configSchema>, ConfigDto>>,
  Assert<Equal<InferOutput<typeof commandSchema>, CommandDto>>,
];

interface RoomInfoBase {
  settings: RoomSettings;
  roomId: string;
  gameIndex: number;
  host: PlayerIdDto;
}

export type RoomInfo = RoomInfoBase &
  (
    | {
        commitment: null;
        commitmentConfig: null;
        commitmentRoster: null;
      }
    | {
        /** Pinned wrapper commitment, verifiable from the published config, start roster, room ID, game index, and revealed seed. */
        commitment: string;
        commitmentConfig: ConfigDto;
        commitmentRoster: PlayerIdDto[];
      }
  );

export type RoomView = Omit<PlayerViewDto | HostViewDto, 'seedCommitment'> & {
  /** Engine commitment recomputed from the live roster, not a verifiable promise about the published game-start inputs. */
  seedCommitment: string;
};

export type ClientMessage =
  | { type: 'command'; command: CommandDto }
  | { type: 'newGame'; config: ConfigDto | null }
  | { type: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'resync' };

export interface GameLogResponse {
  type: 'gameLog';
  gameIndex: number;
  host: PlayerIdDto;
  log: EventDto[];
}

export type ServerMessage =
  | {
      type: 'snapshot';
      view: RoomView;
      room: RoomInfo;
      drawnOrder: number[];
    }
  | { type: 'events'; events: EventDto[]; drawnOrder: number[] }
  | { type: 'error'; code: string; detail: string | null };
