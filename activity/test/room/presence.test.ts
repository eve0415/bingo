import type { RoomState } from '../../app/room/connection';
import type { PresenceActivity } from '../../app/room/presence';

import { describe, expect, it } from 'vitest';

import { initialRoomState } from '../../app/room/connection';
import { advanceClock, idleClock, presenceOf, presenceSink } from '../../app/room/presence';

import { HOST, ME, OTHER, card, room, state, view } from './fixture';

/** Every case here is one room state away from the fixture, so the difference under test is the only thing on the line. */
const roomState = (patch: Partial<RoomState>): RoomState => ({
  ...state(),
  ...patch,
});

const shown = (value: RoomState, startedAt: number | null = null): PresenceActivity => {
  const update = presenceOf(value, ME, startedAt);
  if (update.kind !== 'show') throw new Error(`expected a presence to show, got ${update.kind}`);
  return update.activity;
};

describe('deciding what a room is worth telling discord', () => {
  it('leaves the default card alone until the room has answered', () => {
    expect(presenceOf(initialRoomState, ME, null)).toEqual({
      kind: 'keep',
    });
  });

  it('clears the card when the room closes, even though the last view is still in hand', () => {
    expect(
      presenceOf(
        roomState({
          status: 'closed',
        }),
        ME,
        null,
      ),
    ).toEqual({
      kind: 'clear',
    });
  });

  it('names the game and the phase, and counts the room against its own ceiling', () => {
    expect(shown(state())).toEqual({
      type: 0,
      details: 'プレイ中',
      state: 'ゲーム 3・プレイ中',
      party: {
        size: [2, 25],
      },
    });
  });

  it('says what this player is doing rather than what the room is', () => {
    const reaching = roomState({
      view: {
        ...view(),
        cards: [
          {
            ...card(ME),
            reach: [[0, 1, 2, 3, 4]],
          },
        ],
      },
    });
    expect(shown(reaching).details).toBe('リーチ');
  });

  it('reports the host as the host, which is what the roster shows too', () => {
    expect(shown(roomState({}), null)).toBeDefined();
    expect(presenceOf(state(), HOST, null)).toMatchObject({
      activity: {
        details: 'ホスト',
      },
    });
  });

  it('calls somebody who is not seated a spectator', () => {
    expect(shown(state(), null)).toMatchObject({
      details: 'プレイ中',
    });
    expect(presenceOf(state(), OTHER, null)).toMatchObject({
      activity: {
        details: '観戦中',
      },
    });
  });

  it('falls back to the bare phase when no room has been described yet', () => {
    const started = shown(
      roomState({
        room: null,
      }),
    );
    expect(started.state).toBe('プレイ中');
    expect(started.party).toBeUndefined();
  });

  it('sends the start as unix seconds, which is the unit the activity object takes', () => {
    expect(shown(state(), 1_723_137_832_500).timestamps).toEqual({
      start: 1_723_137_832,
    });
  });
});

describe('counting from the game rather than from the last draw', () => {
  it('starts the clock the first time it sees a game running', () => {
    expect(advanceClock(idleClock, state(), 1000)).toEqual({
      gameIndex: 3,
      startedAt: 1000,
    });
  });

  it('holds the start still while the same game runs on', () => {
    const started = advanceClock(idleClock, state(), 1000);
    expect(advanceClock(started, state(), 9999)).toBe(started);
  });

  it('restarts the clock when the host opens the next game', () => {
    const started = advanceClock(idleClock, state(), 1000);
    const next = roomState({
      room: {
        ...room(),
        gameIndex: 4,
      },
    });
    expect(advanceClock(started, next, 5000)).toEqual({
      gameIndex: 4,
      startedAt: 5000,
    });
  });

  it('has no start to report outside a running game', () => {
    const lobby = roomState({
      view: {
        ...view(),
        phase: 'Lobby',
      },
    });
    expect(advanceClock(idleClock, lobby, 1000)).toEqual({
      gameIndex: 3,
      startedAt: null,
    });
  });
});

/** A push that records what it was given, and can be told to fail the way a client with a revoked scope would. */
const recorder = (failing = false): { sent: (PresenceActivity | null)[]; push: (activity: PresenceActivity | null) => Promise<unknown> } => {
  const sent: (PresenceActivity | null)[] = [];
  return {
    sent,
    push: async (activity): Promise<unknown> => {
      sent.push(activity);
      if (failing) throw new Error('missing scope');
      return await Promise.resolve(null);
    },
  };
};

/** The sink queues its updates, so a timer beats counting the microtasks between an update and the push it ends in. */
const settle = async (): Promise<void> =>
  await new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });

describe('spending presence updates', () => {
  it('says nothing at all while the room has said nothing', async () => {
    const { push, sent } = recorder();
    presenceSink(push).update(initialRoomState, ME);
    await settle();
    expect(sent).toEqual([]);
  });

  it('does not repeat itself when the room changes in ways the card cannot show', async () => {
    const { push, sent } = recorder();
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    sink.update(
      roomState({
        drawnOrder: [1, 2, 3, 4, 5],
      }),
      ME,
    );
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('sends again once the card would read differently', async () => {
    const { push, sent } = recorder();
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    sink.update(
      roomState({
        view: {
          ...view(),
          players: [HOST, ME, OTHER],
        },
      }),
      ME,
    );
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)).toMatchObject({
      party: {
        size: [3, 25],
      },
    });
  });

  it('clears the card when the room closes, and only once', async () => {
    const { push, sent } = recorder();
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    const closed = roomState({
      status: 'closed',
    });
    sink.update(closed, ME);
    sink.update(closed, ME);
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)).toBeNull();
  });

  it('clears the card when the screen goes away without the room closing', async () => {
    const { push, sent } = recorder();
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    sink.close();
    await settle();
    expect(sent.at(-1)).toBeNull();
  });

  it('swallows a client that refuses the update rather than throwing into the room', async () => {
    const { push, sent } = recorder(true);
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('leaves a newer reading standing when the one it replaced is refused', async () => {
    const sent: (PresenceActivity | null)[] = [];
    const sink = presenceSink(
      async activity => {
        sent.push(activity);
        if (sent.length === 1) throw new Error('missing scope');
        return await Promise.resolve(null);
      },
      () => 1000,
    );
    sink.update(state(), ME);
    const fuller = roomState({
      view: {
        ...view(),
        players: [HOST, ME, OTHER],
      },
    });
    sink.update(fuller, ME);
    await settle();
    sink.update(fuller, ME);
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('says a refused reading again, because a card that never took it is not a card that has it', async () => {
    const { push, sent } = recorder(true);
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    await settle();
    sink.update(state(), ME);
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('says it again after a close, so a screen that comes back has a card to fill', async () => {
    const { push, sent } = recorder();
    const sink = presenceSink(push, () => 1000);
    sink.update(state(), ME);
    sink.close();
    sink.update(state(), ME);
    await settle();
    expect(sent).toHaveLength(3);
    expect(sent.at(-1)).toEqual(sent.at(0));
  });

  it('reads the clock itself when nothing hands it one', async () => {
    const { push, sent } = recorder();
    presenceSink(push).update(state(), ME);
    await settle();
    expect(typeof sent.at(0)?.timestamps?.start).toBe('number');
  });
});
