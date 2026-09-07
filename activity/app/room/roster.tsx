import type { PlayerStatus } from './chip';
import type { JSX } from 'react';

import { StatusChip } from './chip';
import { initialOf } from './profiles';

/** A player Discord never reported has no picture, so the roster keeps a drawn one from the name to stand in for it. */
const AVATARS = 5;

/** Which roster a row belongs to. Nobody is playing in the lobby, so the row names the host in words where the game's row wears a status chip. */
export type RosterKind = 'game' | 'lobby';

/** How much of a card is filled in. The roster draws it as well as reading it out, so it carries the numbers rather than a rendered count. */
export interface RosterMarks {
  readonly marked: number;
  readonly total: number;
}

export interface RosterEntry {
  readonly key: string;
  readonly name: string;
  readonly status: PlayerStatus;
  readonly seed: number;
  readonly avatar: string | null;
  readonly isYou: boolean;
  readonly isHost: boolean;
  /** Null while the game is not running, or where the projection withheld the cards — either way there is no count to draw. */
  readonly marks: RosterMarks | null;
}

/** The drawn initial stays underneath the picture, so a portrait Discord refuses to serve uncovers it rather than a hole. */
const Avatar = ({ entry }: { entry: RosterEntry }): JSX.Element => (
  <span aria-hidden="true" data-bingo-avatar="" data-seed={entry.seed % AVATARS}>
    {initialOf(entry.name)}
    {entry.avatar === null ? null : <img alt="" data-bingo-avatar-image="" src={entry.avatar} />}
    {entry.isHost ? <span data-bingo-avatar-host="">▲</span> : null}
  </span>
);

/**
 * Nobody is playing yet, so a chip reading 待機中 beside every name would report the phase four times over.
 * The one thing worth naming is who is running the room, and that is said in words on the row it belongs to.
 */
const NamedBody = ({ entry }: { entry: RosterEntry }): JSX.Element => (
  <>
    <Avatar entry={entry} />
    <span data-bingo-roster-identity="">
      <span data-bingo-roster-person="" title={entry.name}>
        {entry.name}
      </span>
      {entry.isYou ? <span data-bingo-roster-you="">· あなた</span> : null}
      {entry.isHost ? <span data-bingo-roster-role="">ホスト</span> : null}
    </span>
  </>
);

const Body = ({ entry }: { entry: RosterEntry }): JSX.Element => (
  <>
    <Avatar entry={entry} />
    <span data-bingo-roster-text="">
      <span data-bingo-roster-name="">
        {entry.name}
        {entry.isYou ? <span data-bingo-roster-you=""> · あなた</span> : null}
      </span>
      {/* The line is reserved whether or not there is a count in it, so a roster does not reflow as the game starts. */}
      <span data-bingo-roster-marks="">
        {entry.marks === null ? null : (
          <>
            <span aria-hidden="true" data-bingo-roster-bar="" data-status={entry.status}>
              <span data-bingo-roster-fill="" style={{ inlineSize: `${Math.round((entry.marks.marked / entry.marks.total) * 100)}%` }} />
            </span>
            {entry.marks.marked} / {entry.marks.total}
          </>
        )}
      </span>
    </span>
    <StatusChip size="sm" status={entry.status} />
  </>
);

/** The row keeps a fixed height whether or not it is showing a mark count, so a roster does not reflow as a game starts. */
export const RosterRow = ({ entry, onOpen, roster = 'game' }: { entry: RosterEntry; onOpen?: () => void; roster?: RosterKind }): JSX.Element => {
  const body = roster === 'game' ? <Body entry={entry} /> : <NamedBody entry={entry} />;
  return onOpen === undefined ? (
    <div data-bingo-roster-row="" data-roster={roster} data-you={entry.isYou}>
      {body}
    </div>
  ) : (
    <button aria-label={`${entry.name}のカードを見る`} data-bingo-roster-row="" data-roster={roster} data-you={entry.isYou} onClick={onOpen} type="button">
      {body}
    </button>
  );
};
