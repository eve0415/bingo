import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { InferOutput } from 'valibot';

import { maxLength, nonEmpty, pipe, safeParse, strictObject, string } from 'valibot';

export const VERIFIED_IDENTITY_HEADER = 'x-bingo-verified-identity';
export const ROOM_KEY_HEADER = 'x-bingo-room-key';
export const ROOM_MODE_HEADER = 'x-bingo-room-mode';
export const GAME_INDEX_HEADER = 'x-bingo-game-index';
export const SELECTED_PROTOCOL_HEADER = 'x-bingo-selected-protocol';
/** A socket carries its player on the connection itself, and workerd caps that attachment, so an unbounded name would fail the upgrade rather than the request. */
const MAX_IDENTITY_TEXT_LENGTH = 256;
/** Identity is the wrapper's own vocabulary rather than the engine's, so its bounds belong in the schema that reads it. */
const identityText = pipe(string(), nonEmpty(), maxLength(MAX_IDENTITY_TEXT_LENGTH));
export const playerIdSchema = strictObject({
  issuer: identityText,
  subject: identityText,
});
export const verifiedIdentitySchema = strictObject({
  player: playerIdSchema,
  displayName: identityText,
});
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;
export type PlayerIdSchemaMatchesGenerated = Assert<Equal<InferOutput<typeof playerIdSchema>, PlayerIdDto>>;

export type VerifiedIdentity = InferOutput<typeof verifiedIdentitySchema>;
/** A player id is a pair, so every identity comparison must include both components. */
export const samePlayer = (left: PlayerIdDto, right: PlayerIdDto): boolean => left.issuer === right.issuer && left.subject === right.subject;
export const playerKey = (player: PlayerIdDto): string => `${player.issuer}\u0000${player.subject}`;
export const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
export const encodeIdentity = (identity: VerifiedIdentity): string => JSON.stringify(identity);
export const decodeIdentity = (value: string | null): VerifiedIdentity | null => {
  if (value === null) return null;
  const result = safeParse(verifiedIdentitySchema, parseJson(value));
  return result.success ? result.output : null;
};
