import type { PlayerStatus } from './chip';
import type { JSX } from 'react';

import { StatusChip } from './chip';
import { initialOf } from './names';

/** Discord avatars would be a third-party fetch the activity's frame has no mapping for, so the roster draws its own from the name. */
const AVATARS = 5;

export interface RosterEntry {
  readonly key: string;
  readonly name: string;
  readonly status: PlayerStatus;
  readonly seed: number;
  readonly isYou: boolean;
  readonly isHost: boolean;
  readonly marks: string;
}

const Body = ({ entry }: { entry: RosterEntry }): JSX.Element => (
  <>
    <span aria-hidden="true" data-bingo-avatar="" data-seed={entry.seed % AVATARS}>
      {initialOf(entry.name)}
      {entry.isHost ? <span data-bingo-avatar-host="">▲</span> : null}
    </span>
    <span data-bingo-roster-text="">
      <span data-bingo-roster-name="">
        {entry.name}
        {entry.isYou ? <span data-bingo-roster-you=""> · あなた</span> : null}
      </span>
      <span data-bingo-roster-marks="">{entry.marks}</span>
    </span>
    <StatusChip size="sm" status={entry.status} />
  </>
);

/** The row keeps a fixed height whether or not it is showing a mark count, so a roster does not reflow as a game starts. */
export const RosterRow = ({ entry, onOpen }: { entry: RosterEntry; onOpen?: () => void }): JSX.Element =>
  onOpen === undefined ? (
    <div data-bingo-roster-row="" data-you={entry.isYou}>
      <Body entry={entry} />
    </div>
  ) : (
    <button aria-label={`${entry.name}のカードを見る`} data-bingo-roster-row="" data-you={entry.isYou} onClick={onOpen} type="button">
      <Body entry={entry} />
    </button>
  );
