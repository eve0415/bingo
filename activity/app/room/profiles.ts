import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';

import { playerKey } from '@bingo/wrapper/identity';

/** What Discord knows about one person: the room knows players only as issuer and subject. */
export interface PlayerProfile {
  readonly name: string;
  /** The picture Discord draws for them, or nothing when this instance never reported them. */
  readonly avatar: string | null;
}

/** Profiles come from the Discord instance rather than the room, which carries no display data at all. */
export type ProfileLookup = ReadonlyMap<string, PlayerProfile>;

/** Enough of a snowflake to tell two unnamed players apart without showing an account id. */
const TAIL = 4;
const SEED_CYCLE = 997;

export const nameOf = (player: PlayerIdDto, profiles: ProfileLookup): string =>
  profiles.get(playerKey(player))?.name ?? `プレイヤー ${player.subject.slice(-TAIL)}`;

/** A player the instance never reported has no picture, and the drawn initial stands in for one. */
export const avatarOf = (player: PlayerIdDto, profiles: ProfileLookup): string | null => profiles.get(playerKey(player))?.avatar ?? null;

/** A stable colour per player, so the same person keeps the same avatar for as long as the room lasts. */
export const seedOf = (player: PlayerIdDto): number => {
  const key = playerKey(player);
  return Array.from({ length: key.length }, (_, index) => key.charCodeAt(index)).reduce((total, code) => (total + code) % SEED_CYCLE, 0);
};

const SEGMENTER = new Intl.Segmenter();

/** A name may open with an emoji or a combining sequence, so the avatar takes the first grapheme rather than the first code unit. */
export const initialOf = (name: string): string =>
  [...SEGMENTER.segment(name)]
    .slice(0, 1)
    .map(part => part.segment)
    .join('');
