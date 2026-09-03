import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';

import { playerKey } from '@bingo/wrapper/identity';

/** Display names come from the Discord instance rather than the room, which knows players only as issuer and subject. */
export type NameLookup = ReadonlyMap<string, string>;

/** Enough of a snowflake to tell two unnamed players apart without showing an account id. */
const TAIL = 4;
const SEED_CYCLE = 997;

export const nameOf = (player: PlayerIdDto, names: NameLookup): string => names.get(playerKey(player)) ?? `プレイヤー ${player.subject.slice(-TAIL)}`;

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
