import type { SessionEnvironment } from '../app/session';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { guildAvatars } from '../app/avatars';
import { mintRoomToken } from '../app/identity';

const INSTANCE_ID = 'instance-1';
const OTHER_INSTANCE_ID = 'instance-2';
const instanceUrl = (instance: string): string => `https://discord.com/api/applications/test-client-id/activity-instances/${instance}`;
const INSTANCE_URL = instanceUrl(INSTANCE_ID);
const OTHER_INSTANCE_URL = instanceUrl(OTHER_INSTANCE_ID);
const GUILD_ID = '1181199416875556937';
/** Long enough that the endpoint stops reusing Discord's record of an instance, short enough that it still holds the pictures. */
const PAST_INSTANCE_TTL_MS = 10_000;
/** Both of the endpoint's caches outlive a test, so each test starts far enough on that nothing an earlier one held is still fresh. */
const CLOCK_STEP_MS = 600_000;
let clock = Date.parse('2026-09-03T00:00:00Z');
const memberUrl = (user: string): string => `https://discord.com/api/guilds/${GUILD_ID}/members/${user}`;

const ENVIRONMENT: SessionEnvironment = {
  DISCORD_CLIENT_ID: 'test-client-id',
  DISCORD_CLIENT_SECRET: 'test-client-secret',
  DISCORD_BOT_TOKEN: 'test-bot-token',
  SESSION_HMAC_SECRET: 'test-session-secret',
};

interface ExpectedDiscordRequest {
  url: string;
  status: number;
  responseBody: string | symbol;
}

let pendingDiscordRequests: ExpectedDiscordRequest[] = [];

/** Stands for a request that never reaches Discord at all, which is a different answer from one Discord refused. */
const THROWS = Symbol('unreachable');

const sent = (body: string): Response =>
  new Response(body, {
    headers: {
      'Content-Type': 'application/json',
    },
  });

const discordRequest = (url: string, responseBody: string | symbol, status = 200): ExpectedDiscordRequest => ({
  url,
  status,
  responseBody,
});

const instanceBody = (users: string[], guildId: string | null = GUILD_ID): string =>
  JSON.stringify({
    users,
    location: guildId === null ? {} : { guild_id: guildId },
  });

/** Discord's record is documented to carry a location, but the schema tolerates its absence and so must this. */
const unplacedInstanceBody = (users: string[]): string => JSON.stringify({ users });

/** An explicit null is a different shape from an absent key, and rejecting it would fail the join rather than the picture. */
const nullPlacedInstanceBody = (users: string[]): string => JSON.stringify({ users, location: null });

const roomToken = async (room = INSTANCE_ID, subject = 'player-1'): Promise<string> =>
  await mintRoomToken('test-session-secret', {
    issuer: 'discord',
    subject,
    displayName: 'プレイヤー',
    room,
    lifetimeSeconds: 60,
  });

const lookup = (token: string | null, instance: string | null = INSTANCE_ID): Request =>
  new Request(`https://activity.test/api/avatars${instance === null ? '' : `?instance=${encodeURIComponent(instance)}`}`, {
    headers: token === null ? {} : { Authorization: token },
  });

/** Everything but the case under test is in order, so a refusal names the one thing that is not. */
const authorized = async (): Promise<Request> => lookup(`Bearer ${await roomToken()}`);

const authorizedFor = async (instance: string): Promise<Request> => lookup(`Bearer ${await roomToken(instance)}`, instance);

/** Somebody else in the same instance, which is how a record gets held before the player under test asks about it. */
const authorizedAs = async (subject: string): Promise<Request> => lookup(`Bearer ${await roomToken(INSTANCE_ID, subject)}`);

const expectFailure = async (response: Response, status: number, error: string, detail?: string): Promise<void> => {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(detail === undefined ? { error } : { error, detail });
};

beforeEach((): void => {
  clock += CLOCK_STEP_MS;
  vi.setSystemTime(clock);
  pendingDiscordRequests = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init): Promise<Response> => {
    const expectedRequest = pendingDiscordRequests.shift();
    if (expectedRequest === undefined) throw new Error('unexpected unmocked Discord request');
    const request = new Request(input, init);
    expect(await request.text()).toBe('');
    expect(request.url).toBe(expectedRequest.url);
    expect(request.headers.get('Authorization')).toBe('Bot test-bot-token');
    if (typeof expectedRequest.responseBody !== 'string') throw new Error('the network did not answer');
    return new Response(expectedRequest.responseBody, {
      status: expectedRequest.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });
});

afterEach((): void => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  expect(pendingDiscordRequests, 'all mocked Discord requests should be consumed').toHaveLength(0);
});

describe('the per-server picture lookup', () => {
  it('rejects a missing Discord client id without calling Discord', async (): Promise<void> => {
    await expectFailure(await guildAvatars({}, await authorized()), 500, 'MissingDiscordCredentials');
  });

  it('rejects a missing bot token without calling Discord', async (): Promise<void> => {
    const environment = { ...ENVIRONMENT, DISCORD_BOT_TOKEN: '' };
    await expectFailure(await guildAvatars(environment, await authorized()), 500, 'MissingIdentityCredentials');
  });

  it('rejects a missing session secret without calling Discord', async (): Promise<void> => {
    const environment = { ...ENVIRONMENT, SESSION_HMAC_SECRET: '' };
    await expectFailure(await guildAvatars(environment, await authorized()), 500, 'MissingIdentityCredentials');
  });

  it('refuses a request that names no instance', async (): Promise<void> => {
    const unaddressed = lookup(`Bearer ${await roomToken()}`, null);
    await expectFailure(await guildAvatars(ENVIRONMENT, unaddressed), 401, 'MissingAuthorization');
  });

  it('refuses a request with no bearer token', async (): Promise<void> => {
    await expectFailure(await guildAvatars(ENVIRONMENT, lookup(null)), 401, 'MissingAuthorization');
  });

  it('refuses an authorization header that is not a bearer token', async (): Promise<void> => {
    const bare = lookup(await roomToken());
    await expectFailure(await guildAvatars(ENVIRONMENT, bare), 401, 'MissingAuthorization');
  });

  it('refuses a token minted for another room', async (): Promise<void> => {
    const elsewhere = lookup(`Bearer ${await roomToken('instance-2')}`);
    await expectFailure(await guildAvatars(ENVIRONMENT, elsewhere), 401, 'MissingAuthorization');
  });

  it('reports a failed activity-instance lookup', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, '{}', 404));
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 502, 'InstanceLookupRejected', 'discord returned 404');
  });

  it('hands each request waiting on one refused lookup a body of its own to read', async (): Promise<void> => {
    // Both callers wait on the same lookup, so one Discord request answers both; the refusal they share must not be one object with one body.
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, '{}', 404));
    // Both tokens are minted first: an await between the two calls would let the first lookup finish, and then the second would start its own.
    const mine = await authorized();
    const theirs = await authorizedAs('player-9');
    const [one, two] = await Promise.all([guildAvatars(ENVIRONMENT, mine), guildAvatars(ENVIRONMENT, theirs)]);
    expect(one).not.toBe(two);
    await expectFailure(one, 502, 'InstanceLookupRejected', 'discord returned 404');
    await expectFailure(two, 502, 'InstanceLookupRejected', 'discord returned 404');
  });

  it('reports a malformed activity-instance response', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, '{'));
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 502, 'InstanceLookupMalformed');
  });

  it('refuses a player who has left the instance the token names', async (): Promise<void> => {
    // The record was just asked for, so it is the newest word there is and a miss against it is the player's rather than its own.
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, instanceBody(['player-2'])));
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
  });

  it('asks again rather than refusing a player the record it was holding was too old to know about', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-9'], null)),
      // The held record predates this player's join by less than its own lifetime, so the miss belongs to the record rather than to the player.
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-9'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      discordRequest(memberUrl('player-9'), JSON.stringify({ avatar: null })),
    );
    const warmed = await guildAvatars(ENVIRONMENT, await authorizedAs('player-9'));
    expect(warmed.status).toBe(200);
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: ['player-1', 'player-9'], avatars: { 'player-1': 'server-hash' }, complete: true });
  });

  it('spends one lookup on a player the instance keeps leaving out, however often they ask', async (): Promise<void> => {
    // A room token lives for hours, so a holder who has left could otherwise spend the bot's rate limit — the limit the join path depends on — one request at a time.
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, instanceBody(['player-2'])));
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
    // The drained queue is the whole assertion: everything after the first request was answered without asking Discord again.
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
  });

  it('asks once for a player who keeps missing, even when the record it was holding is refreshed around them', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-9'], null)),
      // The one ask the miss is worth; every request after it is answered from the record that ask wrote.
      discordRequest(INSTANCE_URL, instanceBody(['player-9'], null)),
    );
    const warmed = await guildAvatars(ENVIRONMENT, await authorizedAs('player-9'));
    expect(warmed.status).toBe(200);
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
  });

  it('collapses a burst from one player the record leaves out into a single fresh lookup', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, instanceBody(['player-9'], null)), discordRequest(INSTANCE_URL, instanceBody(['player-9'], null)));
    const warmed = await guildAvatars(ENVIRONMENT, await authorizedAs('player-9'));
    expect(warmed.status).toBe(200);
    // Both tokens are minted first: an await between the two calls would let the first miss settle, and the second would then be the sequential case above.
    const mine = await authorized();
    const again = await authorized();
    const [one, two] = await Promise.all([guildAvatars(ENVIRONMENT, mine), guildAvatars(ENVIRONMENT, again)]);
    await expectFailure(one, 403, 'NotInInstance');
    await expectFailure(two, 403, 'NotInInstance');
  });

  it('reports an instance lookup that failed on the ask a miss called for', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, instanceBody(['player-9'], null)), discordRequest(INSTANCE_URL, '{}', 404));
    const warmed = await guildAvatars(ENVIRONMENT, await authorizedAs('player-9'));
    expect(warmed.status).toBe(200);
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 502, 'InstanceLookupRejected', 'discord returned 404');
  });

  it('finds nothing for an activity opened outside a server', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, instanceBody(['player-1'], null)));
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ guildId: null, users: ['player-1'], avatars: {}, complete: true });
  });

  it('finds nothing for an instance record that names no location at all', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, unplacedInstanceBody(['player-1'])));
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ guildId: null, users: ['player-1'], avatars: {}, complete: true });
  });

  it('reads an instance record whose location Discord sent as null', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, nullPlacedInstanceBody(['player-1'])));
    // An explicit null once cost the whole join rather than the picture, because the record failed to parse at all.
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ guildId: null, users: ['player-1'], avatars: {}, complete: true });
  });

  it('asks about nobody in an instance Discord reports as empty', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, instanceBody([])));
    // The membership check is what keeps an empty roster from ever reaching a member lookup, and the drained queue proves it.
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 403, 'NotInInstance');
  });

  it('stops asking about a server the bot was never added to, and holds that answer', async (): Promise<void> => {
    const roster = ['player-1', 'player-2', 'player-3'];
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      // Only the first member is asked about: a refusal answers for the whole server, and the queue drain proves the rest were spared.
      discordRequest(memberUrl('player-1'), JSON.stringify({ message: 'Missing Access' }), 403),
      discordRequest(INSTANCE_URL, instanceBody(roster)),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: {}, complete: true });
    // A refusal is settled rather than merely unanswered, so the second caller is answered without asking the bot again.
    vi.setSystemTime(clock + PAST_INSTANCE_TTL_MS);
    const second = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await second.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: {}, complete: true });
  });

  it('stops at the probe when Discord names the server as the thing it cannot find', async (): Promise<void> => {
    const roster = ['player-1', 'player-2', 'player-3'];
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      // Installing an activity in a server adds no bot to it, so a guild sub-route answers 404 Unknown Guild rather than 403.
      // Reading that as one member's absence would send the whole roster after it, on the bucket the token exchange shares.
      discordRequest(memberUrl('player-1'), JSON.stringify({ code: 10_004, message: 'Unknown Guild' }), 404),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: {}, complete: true });
  });

  it('keeps asking after a 404 that names the member rather than the server', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-2', 'player-3'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ code: 10_007, message: 'Unknown Member' }), 404),
      discordRequest(memberUrl('player-2'), JSON.stringify({ avatar: 'server-hash' })),
      // A 404 that names nothing readable is still a 404 about one member, not about the server.
      discordRequest(memberUrl('player-3'), '{', 404),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({
      guildId: GUILD_ID,
      users: ['player-1', 'player-2', 'player-3'],
      avatars: { 'player-2': 'server-hash' },
      complete: true,
    });
  });

  it('reports a member Discord refused mid-roster without unsettling the answer', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-10'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      // The bot lost access to the server between the two asks, which says nothing further is ever coming for this member.
      discordRequest(memberUrl('player-10'), JSON.stringify({ message: 'Missing Access' }), 401),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: ['player-1', 'player-10'], avatars: { 'player-1': 'server-hash' }, complete: true });
  });

  it('keeps asking after a member lookup that merely failed', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-2'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      discordRequest(memberUrl('player-2'), '', 500),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: ['player-1', 'player-2'], avatars: { 'player-1': 'server-hash' }, complete: false });
  });

  it('spends nothing more on a bucket that would not answer the first ask', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-2', 'player-3'])),
      // A rate limit answers the same way for everyone behind it, so the roster is abandoned rather than walked.
      discordRequest(memberUrl('player-1'), '', 429),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: ['player-1', 'player-2', 'player-3'], avatars: {}, complete: false });
  });

  it('survives a member lookup that never reaches Discord', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-6'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: null })),
      discordRequest(memberUrl('player-6'), THROWS),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: ['player-1', 'player-6'], avatars: {}, complete: false });
  });

  it('asks Discord again once the answer it is holding has gone stale', async (): Promise<void> => {
    const roster = ['player-1', 'player-7'];
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'first-hash' })),
      discordRequest(memberUrl('player-7'), JSON.stringify({ avatar: null })),
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'second-hash' })),
      discordRequest(memberUrl('player-7'), JSON.stringify({ avatar: null })),
    );
    const first = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await first.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: { 'player-1': 'first-hash' }, complete: true });
    // Far enough on that the held answer is dropped rather than served, which is also what keeps the memory bounded.
    vi.setSystemTime(clock + 300_000);
    const later = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await later.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: { 'player-1': 'second-hash' }, complete: true });
  });

  it('answers a second caller from the answer it is holding, without asking Discord again', async (): Promise<void> => {
    // A roster of its own, because the held answers outlive a test and an earlier fan-out would otherwise answer this one.
    const roster = ['player-1', 'player-5'];
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      discordRequest(memberUrl('player-5'), JSON.stringify({ avatar: null })),
    );
    const first = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await first.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: { 'player-1': 'server-hash' }, complete: true });
    // Within the few seconds the instance record is reused for, the second caller costs Discord nothing at all.
    const second = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await second.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: { 'player-1': 'server-hash' }, complete: true });
  });

  it('returns the picture each member set for this server', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-2', 'player-3', 'player-4'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      // A member who set no picture for this server, one Discord has no record of, and one it answered unusably.
      discordRequest(memberUrl('player-2'), JSON.stringify({ avatar: null })),
      discordRequest(memberUrl('player-3'), JSON.stringify({ message: 'Unknown Member' }), 404),
      discordRequest(memberUrl('player-4'), '{'),
    );
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      guildId: GUILD_ID,
      users: ['player-1', 'player-2', 'player-3', 'player-4'],
      avatars: {
        'player-1': 'server-hash',
      },
      // Discord had no record of player-3, which is an answer; the body it sent for player-4 was not one.
      complete: false,
    });
  });

  it('does not hold an answer Discord was rate limiting, and asks again about the members it missed', async (): Promise<void> => {
    const roster = ['player-1', 'player-8'];
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: null })),
      discordRequest(memberUrl('player-8'), JSON.stringify({ message: 'You are being rate limited.' }), 429),
      // The instance record is still being reused, so the second caller costs only the member lookups the first missed.
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: null })),
      discordRequest(memberUrl('player-8'), JSON.stringify({ avatar: 'late-hash' })),
    );
    const first = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await first.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: {}, complete: false });
    // Held, this would have shown player-8 their account picture for the rest of the room's life.
    const second = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await second.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: { 'player-8': 'late-hash' }, complete: true });
  });

  it('answers as an outage when the instance lookup never reached Discord', async (): Promise<void> => {
    pendingDiscordRequests.push(discordRequest(INSTANCE_URL, THROWS));
    await expectFailure(await guildAvatars(ENVIRONMENT, await authorized()), 502, 'InstanceLookupRejected', 'discord could not be reached');
  });

  it('collapses a burst that arrives while the first lookup is still out', async (): Promise<void> => {
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(['player-1', 'player-8'])),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'first-hash' })),
      discordRequest(memberUrl('player-8'), JSON.stringify({ avatar: 'eighth-hash' })),
    );
    // One join wakes every client in the room at once, so the second caller must wait on the lookup already out rather than start its own.
    const [one, two] = [await authorized(), await authorized()];
    const answers = await Promise.all([guildAvatars(ENVIRONMENT, one), guildAvatars(ENVIRONMENT, two)]);
    const bodies = await Promise.all(answers.map(async (answer): Promise<unknown> => await answer.json()));
    const expected = { guildId: GUILD_ID, users: ['player-1', 'player-8'], avatars: { 'player-1': 'first-hash', 'player-8': 'eighth-hash' }, complete: true };
    expect(bodies).toEqual([expected, expected]);
  });

  it('reuses one instance record across a burst, and asks again once it is no longer fresh', async (): Promise<void> => {
    const roster = ['player-1', 'player-11'];
    const elsewhere = ['player-1', 'player-12'];
    pendingDiscordRequests.push(
      discordRequest(INSTANCE_URL, instanceBody(roster)),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      discordRequest(memberUrl('player-11'), JSON.stringify({ avatar: null })),
      // Another instance is held beside the first rather than in place of it.
      discordRequest(OTHER_INSTANCE_URL, instanceBody(elsewhere)),
      discordRequest(memberUrl('player-1'), JSON.stringify({ avatar: 'server-hash' })),
      discordRequest(memberUrl('player-12'), JSON.stringify({ avatar: null })),
      discordRequest(INSTANCE_URL, instanceBody(roster)),
    );
    const held = { guildId: GUILD_ID, users: roster, avatars: { 'player-1': 'server-hash' }, complete: true };
    const first = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await first.json()).toEqual(held);
    const other = await guildAvatars(ENVIRONMENT, await authorizedFor(OTHER_INSTANCE_ID));
    expect(other.status).toBe(200);
    // The rest of the burst one join sets off: answered without asking Discord who is in the instance a second time.
    const during = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await during.json()).toEqual(held);
    // Past the seconds that record is good for, so the roster the membership check runs against is asked for again.
    vi.setSystemTime(clock + PAST_INSTANCE_TTL_MS);
    const after = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await after.json()).toEqual(held);
  });

  it('asks about no more members at once than one route bucket should carry', async (): Promise<void> => {
    const roster = ['player-1', ...Array.from({ length: 12 }, (_, index) => `crowd-${index}`)];
    const asked: string[] = [];
    let inFlight = 0;
    let peak = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init): Promise<Response> => {
      const { url } = new Request(input, init);
      if (url === INSTANCE_URL) return sent(instanceBody(roster));
      asked.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // A real lookup does not answer in the tick it was asked in, and that gap is the only place a cap can be seen at all.
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      return sent(JSON.stringify({ avatar: null }));
    });
    const response = await guildAvatars(ENVIRONMENT, await authorized());
    expect(await response.json()).toEqual({ guildId: GUILD_ID, users: roster, avatars: {}, complete: true });
    // A full room is 75, and all of them at once is one burst against the server's member bucket.
    expect(peak).toBe(6);
    expect(asked).toHaveLength(roster.length);
    expect(new Set(asked).size).toBe(roster.length);
  });
});
