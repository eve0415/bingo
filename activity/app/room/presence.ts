import type { RoomState } from './connection';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { IDiscordSDK } from '@discord/embedded-app-sdk';

import { samePlayer } from '@bingo/wrapper/identity';

import { statusLabel } from './chip';
import { PHASE_LABEL, cardsOf, statusOf } from './model';

/** Derived from the client rather than named, because the SDK exports the command but not the shape of its argument. */
type SetActivity = Parameters<IDiscordSDK['commands']['setActivity']>[0];
export type PresenceActivity = NonNullable<SetActivity['activity']>;

/**
 * Three outcomes, not two: a room that has said nothing yet must leave Discord's own card alone rather than blank it.
 * Discord already shows the app icon and an "Ask to Join" button without being asked, so the worst update is one that replaces that with nothing.
 */
export type PresenceUpdate = { kind: 'keep' } | { kind: 'clear' } | { kind: 'show'; activity: PresenceActivity };

/** Somebody watching a room they are not seated in still has a presence, and the roster has no chip for them. */
const SPECTATOR_LABEL = '観戦中';

/** Type 0 is Playing, which is the header Discord puts above the two lines below. */
const PLAYING = 0;

/** Unix seconds, which is what the guide's own example passes; milliseconds there would put the start tens of thousands of years out. */
const asUnixSeconds = (epochMs: number): number => Math.floor(epochMs / 1000);

/** What this client believes about the game it is watching, kept across updates so a timer counts from the game rather than from the last draw. */
export interface GameClock {
  gameIndex: number | null;
  startedAt: number | null;
}

export const idleClock: GameClock = {
  gameIndex: null,
  startedAt: null,
};

/**
 * The room reports no start time, so the elapsed timer counts from when this client first saw this game running.
 * That is the honest reading of a presence anyway: it is one person's card, and it says how long they have been in this game.
 */
export const advanceClock = (previous: GameClock, state: RoomState, now: number): GameClock => {
  const index = state.room?.gameIndex ?? null;
  if (state.view?.phase !== 'Running') {
    return {
      gameIndex: index,
      startedAt: null,
    };
  }
  if (previous.gameIndex === index && previous.startedAt !== null) return previous;
  return {
    gameIndex: index,
    startedAt: now,
  };
};

/** Whether the room is worth describing at all, which a socket that has not answered yet is not. */
export const presenceOf = (state: RoomState, me: PlayerIdDto, startedAt: number | null): PresenceUpdate => {
  if (state.status === 'closed') {
    return {
      kind: 'clear',
    };
  }
  const { room, view } = state;
  if (view === null) {
    return {
      kind: 'keep',
    };
  }
  const seated = view.players.some(player => samePlayer(player, me));
  return {
    kind: 'show',
    // A field the card has nothing to put in is left out rather than sent as null, which is the shape every published example takes.
    activity: {
      type: PLAYING,
      details: seated ? statusLabel(statusOf(view, me, cardsOf(view, me))) : SPECTATOR_LABEL,
      state: room === null ? PHASE_LABEL[view.phase] : `ゲーム ${room.gameIndex}・${PHASE_LABEL[view.phase]}`,
      // A party turns the second line into Discord's "(n of max)" badge, and the room's own ceiling is the only honest max there is.
      ...(room === null ? {} : { party: { size: [view.players.length, room.settings.maxPlayers] } }),
      ...(startedAt === null ? {} : { timestamps: { start: asUnixSeconds(startedAt) } }),
    },
  };
};

/** What the sink needs of the Discord client, so a test can supply it where no client exists. */
export type PresencePush = (activity: PresenceActivity | null) => Promise<unknown>;

export interface PresenceSink {
  update: (state: RoomState, me: PlayerIdDto) => void;
  close: () => void;
}

/**
 * Presence is a courtesy: it never blocks the room, never throws into it, and never spends an update saying what it has already said.
 * No rate limit is published for the embedded SET_ACTIVITY command, which is the reason nothing here is keyed on the drawn numbers.
 */
export const presenceSink = (push: PresencePush, now: () => number = Date.now): PresenceSink => {
  let clock = idleClock;
  let sent: string | null = null;
  // Updates are queued rather than raced, so a slow one can never land on top of the state that replaced it.
  let pending: Promise<void> = Promise.resolve();
  const send = (activity: PresenceActivity | null): void => {
    const encoded = JSON.stringify(activity);
    if (encoded === sent) return;
    sent = encoded;
    const previous = pending;
    pending = (async (): Promise<void> => {
      await previous;
      try {
        await push(activity);
      } catch {
        // A client that refuses the update leaves the card as it was, which is not something the room needs to hear about.
        // It also never told the card anything, so the same reading has to be allowed to go out again rather than counting as said.
        if (sent === encoded) sent = null;
      }
    })();
  };
  return {
    update: (state, me): void => {
      clock = advanceClock(clock, state, now());
      const update = presenceOf(state, me, clock.startedAt);
      if (update.kind === 'keep') return;
      send(update.kind === 'clear' ? null : update.activity);
    },
    close: (): void => {
      send(null);
    },
  };
};
