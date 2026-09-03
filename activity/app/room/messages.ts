import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { HostViewDto } from '@bingo/wasm/HostViewDto';
import type { PlayerViewDto } from '@bingo/wasm/PlayerViewDto';
import type { RecognizedWinDto } from '@bingo/wasm/RecognizedWinDto';
import type { RevokedMarkDto } from '@bingo/wasm/RevokedMarkDto';
import type { RoomInfo, RoomView, ServerMessage } from '@bingo/wrapper/protocol';
import type { InferOutput } from 'valibot';

import { parseJson, playerIdSchema } from '@bingo/wrapper/identity';
import { configSchema } from '@bingo/wrapper/protocol';
import { roomSettingsSchema } from '@bingo/wrapper/settings';
import { array, literal, null_, nullable, number, object, picklist, safeParse, string, union, variant } from 'valibot';

const numberSchema = number();
const patternSchema = array(numberSchema);
const nullableStringSchema = nullable(string());
// Wrapper request validation stays strict, while separately deployed wrapper responses discard fields this activity does not know yet.
const configInboundSchema = object(configSchema.entries);
const roomSettingsInboundSchema = object(roomSettingsSchema.entries);
const playerIdInboundSchema = object(playerIdSchema.entries);
const sequenceEntries = {
  seq: numberSchema,
};
const playerEventEntries = {
  ...sequenceEntries,
  player: playerIdInboundSchema,
};
const actorEventEntries = {
  ...sequenceEntries,
  actor: playerIdInboundSchema,
};
const positionEntries = {
  cardIx: numberSchema,
  row: numberSchema,
  col: numberSchema,
};
const recognizedWinEntries = {
  winners: array(playerIdInboundSchema),
  patterns: array(patternSchema),
  atSeq: numberSchema,
  rank: numberSchema,
};

export const cardViewSchema = object({
  owner: playerIdInboundSchema,
  cardIx: numberSchema,
  cells: array(numberSchema),
  marked: array(numberSchema),
  bingo: array(patternSchema),
  reach: array(patternSchema),
});

export const recognizedWinSchema = object(recognizedWinEntries);

export const revokedMarkSchema = object({
  player: playerIdInboundSchema,
  ...positionEntries,
});
const revokedMarksSchema = array(revokedMarkSchema);

export const phaseSchema = picklist(['Lobby', 'Running', 'Finished']);

/** These projections intentionally share one schema because their generated wire shapes are identical. */
// The wrapper and activity deploy independently, so server objects discard fields introduced by a newer wrapper while retaining the client-known shape.
export const roomViewSchema = object({
  config: configInboundSchema,
  phase: phaseSchema,
  host: playerIdInboundSchema,
  players: array(playerIdInboundSchema),
  drawn: array(numberSchema),
  wins: array(recognizedWinSchema),
  cards: array(cardViewSchema),
  revealedSeed: nullableStringSchema,
});

export const eventSchema = union([
  object({
    PlayerJoined: object(playerEventEntries),
  }),
  object({
    PlayerLeft: object(playerEventEntries),
  }),
  object({
    MarkPlaced: object({
      ...playerEventEntries,
      ...positionEntries,
    }),
  }),
  object({
    MarkRemoved: object({
      ...playerEventEntries,
      ...positionEntries,
    }),
  }),
  object({
    BingoClaimed: object({
      ...playerEventEntries,
      cardIx: numberSchema,
    }),
  }),
  object({
    GameStarted: object(actorEventEntries),
  }),
  object({
    NumberDrawn: object({
      ...actorEventEntries,
      number: numberSchema,
    }),
  }),
  object({
    DrawUndone: object({
      ...actorEventEntries,
      number: numberSchema,
      revoked: revokedMarksSchema,
    }),
  }),
  object({
    PlayerKicked: object({
      ...actorEventEntries,
      target: playerIdInboundSchema,
    }),
  }),
  object({
    HostTransferred: object({
      ...actorEventEntries,
      target: playerIdInboundSchema,
    }),
  }),
  object({
    GameClosed: object(actorEventEntries),
  }),
  object({
    WinRecognized: object({
      ...sequenceEntries,
      ...recognizedWinEntries,
    }),
  }),
]);

const roomInfoEntries = {
  settings: roomSettingsInboundSchema,
  roomId: string(),
  gameIndex: numberSchema,
  host: playerIdInboundSchema,
};

export const roomInfoSchema = union([
  object({
    ...roomInfoEntries,
    commitment: null_(),
    commitmentConfig: null_(),
    commitmentRoster: null_(),
  }),
  object({
    ...roomInfoEntries,
    commitment: string(),
    commitmentConfig: configInboundSchema,
    commitmentRoster: array(playerIdInboundSchema),
  }),
]);

export const serverMessageSchema = variant('type', [
  object({
    type: literal('snapshot'),
    view: roomViewSchema,
    room: roomInfoSchema,
    drawnOrder: array(numberSchema),
  }),
  object({
    type: literal('events'),
    events: array(eventSchema),
    drawnOrder: array(numberSchema),
  }),
  object({
    type: literal('error'),
    code: string(),
    detail: nullableStringSchema,
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
  Assert<Equal<InferOutput<typeof cardViewSchema>, CardViewDto>>,
  Assert<Equal<InferOutput<typeof recognizedWinSchema>, RecognizedWinDto>>,
  Assert<Equal<InferOutput<typeof revokedMarkSchema>, RevokedMarkDto>>,
  Assert<Equal<InferOutput<typeof phaseSchema>, PlayerViewDto['phase']>>,
  Assert<Equal<InferOutput<typeof eventSchema>, EventDto>>,
  Assert<Equal<InferOutput<typeof roomViewSchema>, PlayerViewDto>>,
  Assert<Equal<InferOutput<typeof roomViewSchema>, HostViewDto>>,
  Assert<Equal<InferOutput<typeof roomViewSchema>, RoomView>>,
  Assert<Equal<InferOutput<typeof roomInfoSchema>, RoomInfo>>,
  Assert<Equal<InferOutput<typeof serverMessageSchema>, ServerMessage>>,
];

/** A WebSocket peer is untrusted and may also be newer than this client, so invalid JSON and unsupported protocol shapes return a bounded rejection to the connection layer. */
export const parseServerMessage = (raw: string): ServerMessage | null => {
  // Only success or failure reaches the caller, so accumulating every issue would let a hostile nested frame consume work without improving the result.
  const parsed = safeParse(serverMessageSchema, parseJson(raw), { abortEarly: true });
  return parsed.success ? parsed.output : null;
};
