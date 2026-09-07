import type { InferOutput } from 'valibot';

import { boolean, integer, maxValue, minValue, number, partial, picklist, pipe, strictObject } from 'valibot';

export const MAX_PLAYERS = 75;

const drawnVisibilitySchema = picklist(['Full', 'LatestOnly', 'Hidden']);

export const roomSettingsSchema = strictObject({
  maxPlayers: pipe(number(), integer(), minValue(1), maxValue(MAX_PLAYERS)),
  drawnVisibility: drawnVisibilitySchema,
  hostAutoClose: boolean(),
  rosterPersistence: picklist(['KeepAcrossGames', 'ClearBetweenGames']),
});

export const roomSettingsUpdateSchema = partial(roomSettingsSchema);

export type DrawnVisibility = InferOutput<typeof drawnVisibilitySchema>;
export type RoomSettings = InferOutput<typeof roomSettingsSchema>;

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: MAX_PLAYERS,
  drawnVisibility: 'Full',
  hostAutoClose: false,
  rosterPersistence: 'KeepAcrossGames',
};

export const DEADLINE_HORIZONS = {
  hostAbsent: 30_000,
  roomEmpty: 5 * 60_000,
  roomVacant: 5 * 60_000,
  revealBackstop: 24 * 60 * 60_000,
  roomGc: 7 * 24 * 60 * 60_000,
  messageRateWindow: 10_000,
  messageRateLimit: 120,
} as const;
