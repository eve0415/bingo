import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { serverAvatarLookup } from '../app/avatars';

const INSTANCE_ID = 'instance-1';
const GUILD_ID = '1181199416875556937';
const LOOKUP_URL = `/api/avatars?instance=${INSTANCE_ID}`;

/** A status this worker answers with rather than a body it answers with, which is a different thing for the lookup to read. */
interface Refusal {
  readonly status: number;
  /** Null for a refusal that names nothing, which is what the runtime's own 500 looks like. */
  readonly error: string | null;
}

type Answer = string | Error | Refusal;

let answers: Answer[] = [];
let asked: string[] = [];

const willAnswer = (...bodies: Answer[]): void => {
  answers.push(...bodies);
};

const refusal = (status: number, error = 'MissingAuthorization'): Refusal => ({
  status,
  error,
});

/** The two rosters these tests ask about, since a worker's answer now names the one it is about. */
const ONE = ['player-1'];
const BOTH = ['player-1', 'player-2'];

/** Longer than the endpoint reuses its record of an instance, which is what the wait in the lookup is set against. */
const CHASE_MS = 6000;

interface Chaser {
  readonly ask: (ids: readonly string[]) => Promise<unknown>;
  /** How many times the lookup has asked to be asked again, which is the client's only account of a question left open. */
  readonly chases: () => number;
  /** The chase that is out, so a test reads what it did rather than what the clock did. */
  readonly settled: () => Promise<unknown>;
}

/**
 * The lookup with the chaser the client gives it, which asks about the roster that is current when the chase comes due rather than the one the chase was armed for.
 * A participants update is the only other thing that asks, and on every path that leaves the question open it has already been spent.
 */
const chaser = (): Chaser => {
  let chases = 0;
  let here: readonly string[] = ONE;
  let chased: Promise<unknown> = Promise.resolve();
  let ask: ((ids: readonly string[]) => Promise<unknown>) | null = null;
  ask = serverAvatarLookup(INSTANCE_ID, 'room-token', (): void => {
    chases += 1;
    chased = ask?.(here) ?? chased;
  });
  const asking = ask;
  return {
    ask: async (ids): Promise<unknown> => {
      here = ids;
      return await asking(ids);
    },
    chases: (): number => chases,
    settled: async (): Promise<unknown> => await chased,
  };
};

const lookup = (): ((ids: readonly string[]) => Promise<unknown>) => chaser().ask;

const body = (avatars: Record<string, string>, users: readonly string[] = ONE, guildId: string | null = GUILD_ID): string =>
  JSON.stringify({
    guildId,
    users,
    avatars,
    complete: true,
  });

/** What the worker sends when Discord did not answer about everyone: the pictures it did find, and that it is not done. */
const partialBody = (avatars: Record<string, string>, users: readonly string[] = ONE): string =>
  JSON.stringify({
    guildId: GUILD_ID,
    users,
    avatars,
    complete: false,
  });

beforeEach((): void => {
  answers = [];
  asked = [];
  // The lookup waits before it chases, and a wait a test does not control is one every test in this file would sit through.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init): Promise<Response> => {
    if (typeof input !== 'string') throw new TypeError('the lookup addresses itself with a url string');
    asked.push(input);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer room-token');
    const answer = answers.shift();
    if (answer === undefined) throw new Error('unexpected unmocked lookup');
    // A real lookup settles after its caller has moved on, and that gap is where a newer roster overtakes an older one.
    await Promise.resolve();
    if (answer instanceof Error) throw answer;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (typeof answer === 'string') return new Response(answer, { headers });
    // A refusal that names nothing is sent as the runtime sends its own: a status, and a body that is not this worker's shape.
    if (answer.error === null) return new Response('<!doctype html><title>Error</title>', { status: answer.status });
    return Response.json(
      {
        error: answer.error,
      },
      {
        status: answer.status,
      },
    );
  });
});

afterEach((): void => {
  // Real timers again, which also drops whatever chase a test left armed rather than letting it reach the next one.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('asking the worker for this server’s pictures', () => {
  it('reports what it was told, addressed to the instance', async (): Promise<void> => {
    willAnswer(body({ 'player-1': 'server-hash' }));
    const answer = await lookup()(['player-1']);
    expect(asked).toEqual([LOOKUP_URL]);
    expect(answer).toEqual({
      guildId: GUILD_ID,
      avatars: new Map([['player-1', 'server-hash']]),
      complete: true,
    });
  });

  it('reads an activity outside a server as belonging to none', async (): Promise<void> => {
    willAnswer(body({}, ONE, null));
    expect(await lookup()(['player-1'])).toEqual({
      guildId: null,
      avatars: new Map(),
      complete: true,
    });
  });

  it('does not ask twice about the same roster, whatever order it arrives in', async (): Promise<void> => {
    willAnswer(body({ 'player-1': 'server-hash' }, BOTH));
    const ask = lookup();
    expect(await ask(['player-1', 'player-2'])).not.toBeNull();
    expect(await ask(['player-2', 'player-1'])).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('asks again once the roster changes', async (): Promise<void> => {
    willAnswer(body({}), body({ 'player-2': 'server-hash' }, BOTH));
    const ask = lookup();
    await ask(['player-1']);
    expect(await ask(['player-1', 'player-2'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('reopens a roster the worker answered unusably', async (): Promise<void> => {
    willAnswer('{"nothing":true}', body({ 'player-1': 'server-hash' }));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    // The same roster is worth asking about again, which is what keeps one blip from costing the whole game its pictures.
    expect(await ask(['player-1'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('reopens a roster the lookup never reached', async (): Promise<void> => {
    willAnswer(new Error('offline'), body({ 'player-1': 'server-hash' }));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    expect(await ask(['player-1'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('drops an answer a newer roster overtook in flight', async (): Promise<void> => {
    willAnswer(body({ 'player-1': 'stale-hash' }), body({ 'player-2': 'fresh-hash' }, BOTH));
    const ask = lookup();
    const older = ask(['player-1']);
    const newer = ask(['player-1', 'player-2']);
    expect(await newer).not.toBeNull();
    expect(await older).toBeNull();
  });

  it('takes an incomplete answer and still asks about the same roster again', async (): Promise<void> => {
    willAnswer(partialBody({ 'player-1': 'server-hash' }, BOTH), body({ 'player-1': 'server-hash', 'player-2': 'late-hash' }, BOTH));
    const ask = lookup();
    // What was found is worth showing at once; what was missed is worth asking about rather than settling for.
    expect(await ask(['player-1', 'player-2'])).toEqual({
      guildId: GUILD_ID,
      avatars: new Map([['player-1', 'server-hash']]),
      complete: false,
    });
    expect(await ask(['player-1', 'player-2'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('leaves an incomplete answer a newer roster overtook alone', async (): Promise<void> => {
    willAnswer(partialBody({}), body({ 'player-2': 'fresh-hash' }, BOTH));
    const ask = lookup();
    const older = ask(['player-1']);
    const newer = ask(['player-1', 'player-2']);
    expect(await newer).not.toBeNull();
    expect(await older).toBeNull();
    // The newer roster was answered for completely, so the overtaken one must not have reopened it.
    expect(await ask(['player-1', 'player-2'])).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('asks again when the answer turns out to be about a roster this one has moved on from', async (): Promise<void> => {
    // The worker may reuse its record of the instance for a few seconds, which is long enough for somebody to have joined since.
    // Taking a complete answer about the older roster would leave the newcomer without a picture until the room changed again.
    willAnswer(body({ 'player-1': 'server-hash' }, ONE), body({ 'player-1': 'server-hash', 'player-2': 'late-hash' }, BOTH));
    const ask = lookup();
    expect(await ask(['player-1', 'player-2'])).toEqual({
      guildId: GUILD_ID,
      avatars: new Map([['player-1', 'server-hash']]),
      complete: true,
    });
    expect(await ask(['player-1', 'player-2'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('stops asking once the worker refuses the room token', async (): Promise<void> => {
    willAnswer(refusal(401));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    // A refused token is refused on every roster, so a room that keeps filling up must not keep asking with it.
    expect(await ask(['player-1', 'player-2'])).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('stops asking when this worker has no credentials to ask with', async (): Promise<void> => {
    willAnswer(refusal(500, 'MissingIdentityCredentials'));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    expect(await ask(['player-1', 'player-2'])).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('reopens a roster after a 500 this worker did not put its name to', async (): Promise<void> => {
    // The runtime answers 500 for anything thrown, from an isolate that failed once to a request that landed mid-deploy.
    // Reading that as settled would end the room's pictures over a blip the next request would have survived.
    willAnswer(refusal(500, 'SomethingElseEntirely'), body({ 'player-1': 'server-hash' }));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    expect(await ask(['player-1'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('reopens a roster after a 500 whose body is not this worker’s at all', async (): Promise<void> => {
    willAnswer({ status: 500, error: null }, body({ 'player-1': 'server-hash' }));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    expect(await ask(['player-1'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('reopens a roster Discord was merely unreachable for', async (): Promise<void> => {
    willAnswer(refusal(502, 'InstanceLookupRejected'), body({ 'player-1': 'server-hash' }));
    const ask = lookup();
    expect(await ask(['player-1'])).toBeNull();
    // Discord being unreachable is a moment, not a verdict, so the same roster is worth asking about again.
    expect(await ask(['player-1'])).not.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('lets an overtaken failure alone rather than reopening a newer roster', async (): Promise<void> => {
    willAnswer(new Error('offline'), body({ 'player-2': 'fresh-hash' }, BOTH), body({}, BOTH));
    const ask = lookup();
    const older = ask(['player-1']);
    const newer = ask(['player-1', 'player-2']);
    expect(await newer).not.toBeNull();
    expect(await older).toBeNull();
    // The newer roster is still answered for, so it is not asked about a second time.
    expect(await ask(['player-1', 'player-2'])).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('chases an answer about a roster it has moved on from, which nothing else would ask about again', async (): Promise<void> => {
    // Somebody joined while the worker was still reusing its record of the instance, so the answer is about the roster before them.
    // The participants update that would ask again is the one already spent on this answer, so the chase is the only thing left that asks.
    willAnswer(body({ 'player-1': 'server-hash' }, ONE), body({ 'player-1': 'server-hash', 'player-2': 'late-hash' }, BOTH));
    const chased = chaser();
    expect(await chased.ask(BOTH)).not.toBeNull();
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    await chased.settled();
    expect(chased.chases()).toBe(1);
    expect(asked).toHaveLength(2);
  });

  it('chases an answer the worker could not finish', async (): Promise<void> => {
    willAnswer(partialBody({ 'player-1': 'server-hash' }), body({ 'player-1': 'server-hash' }));
    const chased = chaser();
    expect(await chased.ask(ONE)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    expect(asked).toHaveLength(2);
    // The chase was answered for completely, so there is nothing left to chase.
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    expect(chased.chases()).toBe(1);
    expect(asked).toHaveLength(2);
  });

  it('stops chasing one roster after a fixed number of tries', async (): Promise<void> => {
    willAnswer(partialBody({}), partialBody({}), partialBody({}));
    const chased = chaser();
    expect(await chased.ask(ONE)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    expect(chased.chases()).toBe(2);
    expect(asked).toHaveLength(3);
    // A roster that never converges, or a Discord that never answers, must not become a request every few seconds for the life of the room.
    await vi.advanceTimersByTimeAsync(CHASE_MS * 10);
    expect(chased.chases()).toBe(2);
    expect(asked).toHaveLength(3);
  });

  it('drops a chase the next roster overtook', async (): Promise<void> => {
    willAnswer(new Error('offline'), body({ 'player-2': 'fresh-hash' }, BOTH));
    const chased = chaser();
    expect(await chased.ask(ONE)).toBeNull();
    // The room changed before the chase came due, and that update asks about the roster the chase would have missed.
    expect(await chased.ask(BOTH)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    expect(chased.chases()).toBe(0);
    expect(asked).toHaveLength(2);
  });

  it('gives the roster after an exhausted one its own tries', async (): Promise<void> => {
    willAnswer(partialBody({}), partialBody({}), partialBody({}), partialBody({}, BOTH), partialBody({}, BOTH));
    const chased = chaser();
    expect(await chased.ask(ONE)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CHASE_MS * 3);
    expect(chased.chases()).toBe(2);
    // Somebody joined, which is a question of its own rather than the one the room had already given up on.
    expect(await chased.ask(BOTH)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CHASE_MS);
    expect(chased.chases()).toBe(3);
    expect(asked).toHaveLength(5);
  });
});
