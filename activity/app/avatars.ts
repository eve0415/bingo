import type { ActivityInstance, SessionEnvironment } from './session';

import { safeParse } from 'valibot';

import { configured } from './env';
import { failure } from './failure';
import { bearerToken, verifyRoomToken } from './identity';
import { lookupInstance } from './session';
import { discordErrorSchema, failureSchema, guildAvatarsSchema, guildMemberSchema } from './token';

/**
 * Discord's CDN is reachable from inside the activity frame without a URL mapping. The published list of policy
 * exemptions names `cdn.discordapp.com/avatars/` but neither the per-server path nor the default one, and says only
 * that it "includes" those entries; Discord's own sample activity loads all three directly, which is the better
 * evidence but not a guarantee. A path the policy turns out to refuse fails like a missing file, and the roster keeps
 * the drawn initial underneath it, so this is worth confirming in a real launch rather than worth designing around.
 */
const CDN = 'https://cdn.discordapp.com';

/** The roster draws avatars at 36px, so this is the smallest power of two Discord offers that survives a 2× screen. */
const SIZE = 128;

/** An account is on the new username system when it has no discriminator, and Discord writes that as a literal zero. */
const MIGRATED = '0';
const NEW_DEFAULTS = 6n;
const LEGACY_DEFAULTS = 5;
/** Discord states the rule as a 22-bit shift of the snowflake, which on a positive id is exactly this division. */
const SNOWFLAKE_SCALE = 2n ** 22n;
const DIGITS = /^\d+$/u;

/** Discord assigns a blank avatar per account: from the snowflake for a migrated username, from the discriminator for a legacy one. */
const defaultIndex = (id: string, discriminator: string): number => {
  if (discriminator !== MIGRATED && DIGITS.test(discriminator)) return Number(discriminator) % LEGACY_DEFAULTS;
  // The development mock fabricates an id that is not a snowflake, and BigInt throws rather than parsing it.
  return DIGITS.test(id) ? Number((BigInt(id) / SNOWFLAKE_SCALE) % NEW_DEFAULTS) : 0;
};

/** Everything Discord offers about one person's picture, in the order the picture is chosen from. */
export interface AvatarSource {
  id: string;
  /** The account's own avatar, which the participants payload carries for everyone in the instance. */
  avatar: string | null;
  discriminator: string;
  /** The server this activity is running in, which the per-guild path is addressed under; a call outside one has none. */
  guildId: string | null;
  /** The picture this person set for this server alone, which only a member lookup reports. */
  guildAvatar: string | null;
}

/**
 * The picture to show for one person: the one they chose for this server, else their account's, else the blank Discord draws.
 * An animated hash is asked for as a still, because a looping avatar is motion the reduced-motion preference cannot stop.
 */
export const avatarUrl = (source: AvatarSource): string => {
  if (source.guildId !== null && source.guildAvatar !== null) {
    return `${CDN}/guilds/${source.guildId}/users/${source.id}/avatars/${source.guildAvatar}.png?size=${SIZE}`;
  }
  if (source.avatar !== null) return `${CDN}/avatars/${source.id}/${source.avatar}.png?size=${SIZE}`;
  // The default endpoint answers at one resolution and ignores a size, so asking for one would only be noise.
  return `${CDN}/embed/avatars/${defaultIndex(source.id, source.discriminator)}.png`;
};

/** What the worker found out about one instance's server, as the roster reads it. */
export interface ServerAvatars {
  readonly guildId: string | null;
  readonly avatars: ReadonlyMap<string, string>;
  /** False when Discord did not answer about someone, so what came back omits members rather than denying them. */
  readonly complete: boolean;
}

/** The statuses this worker answers with when it will never answer for this token: a refused or expired one, and a player the instance does not list. */
const FINAL_REFUSALS = new Set([401, 403]);
/** The two refusals this worker sends as a 500, both of them an environment it was never configured with. */
const MISCONFIGURED = new Set(['MissingDiscordCredentials', 'MissingIdentityCredentials']);
const SERVER_ERROR = 500;

/**
 * Whether a refusal will be the same however often it is asked.
 * A 500 is the one status this worker does not have to itself — the runtime answers with it for anything thrown, from a
 * request that landed mid-deploy to an isolate that failed once — so the two this worker sends deliberately are told
 * apart by the code they name. Reading an unattributed 500 as settled would end the room's pictures over a single blip.
 */
const settled = async (response: Response): Promise<boolean> => {
  if (FINAL_REFUSALS.has(response.status)) return true;
  if (response.status !== SERVER_ERROR) return false;
  const named = safeParse(failureSchema, await response.json().catch(() => null));
  return named.success && MISCONFIGURED.has(named.output.error);
};

/**
 * How long a question left open waits before it is asked again.
 * An answer about a roster this client has moved on from is the endpoint's record of the instance being older than that roster, so the wait deliberately outlasts the INSTANCE_MS below that record is reused for: asking again inside that window is answered from the very record that disagreed, and collects the same disagreement.
 */
const CHASE_MS = 6000;

/**
 * How many times one roster is chased before it is left as it stands.
 * The first chase covers the record above having been older than the roster; the second covers a Discord that was not answering while the first was out.
 * Past that the room is either not converging or not being talked about at all, and a decoration must not go on asking for the life of the room — a join or a leave still asks again by itself.
 */
const CHASES = 2;

/**
 * Asks this worker which pictures the members of one instance set for its server.
 * Answers nothing when there is nothing to say: the same roster was already asked about, a newer roster overtook this
 * one in flight, or the lookup failed — and a failure reopens the question rather than writing the roster off, which is
 * the difference between a picture that arrives late and one that never arrives at all.
 * An answer the worker marks incomplete is handed back for what it does carry and reopens the question for the same reason.
 * Reopening it settles nothing on its own: the only thing that asks is a participants update, and the update that would have asked is the one already spent on the answer that came back unfinished, so a question left open is also chased.
 * `again` is what performs the chase, and it asks about whatever roster is current by then rather than about this one.
 * A refusal is the one answer that settles it: nothing is asked again, because asking again would collect the same refusal on every participants update for the life of the room.
 */
export const serverAvatarLookup = (instance: string, token: string, again: () => void): ((ids: readonly string[]) => Promise<ServerAvatars | null>) => {
  let asked: string | null = null;
  let closed = false;
  /** The roster the chases below are being spent on: a run of asks about one roster shares them, and the next roster is a new question with all of them. */
  let chasing: string | null = null;
  let chases = 0;
  let pending: ReturnType<typeof setTimeout> | undefined = undefined;
  return async ids => {
    if (closed) return null;
    const roll = [...ids].toSorted().join(',');
    if (roll === asked) return null;
    asked = roll;
    // This ask is the chase, whatever was still waiting to perform one; a chase for the roster this one moved on from would ask about people who are no longer here.
    clearTimeout(pending);
    if (chasing !== roll) {
      chasing = roll;
      chases = CHASES;
    }
    /**
     * Reopens the question and arranges for something to ask it again, since nothing else will.
     * Only the attempt that is still the current one may do either; an overtaken one would clear a newer roster's answer and chase the roster this one moved on from.
     */
    const unfinished = (): void => {
      if (roll !== asked) return;
      asked = null;
      if (chases === 0) return;
      chases -= 1;
      pending = setTimeout(again, CHASE_MS);
    };
    try {
      const response = await fetch(`/api/avatars?instance=${encodeURIComponent(instance)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        // A token this worker refuses, an instance it says this player is not in, and an environment it was never configured with all answer the same way however often they are asked, which makes the question settled rather than merely unanswered.
        if (await settled(response)) closed = true;
        else unfinished();
        return null;
      }
      const parsed = safeParse(guildAvatarsSchema, await response.json());
      if (!parsed.success) {
        unfinished();
        return null;
      }
      if (roll !== asked) return null;
      // Discord was not heard from about everyone, so the roster stays open and is chased rather than left for a join that may never come.
      // An answer about a different roster is the same kind of unfinished.
      // The worker may reuse its record of the instance for a few seconds, which is long enough for somebody to have joined since, and their picture is what would go missing.
      if (!parsed.output.complete || [...parsed.output.users].toSorted().join(',') !== roll) unfinished();
      return {
        guildId: parsed.output.guildId ?? null,
        avatars: new Map(Object.entries(parsed.output.avatars)),
        complete: parsed.output.complete,
      };
    } catch {
      unfinished();
      return null;
    }
  };
};

/**
 * What is known about this server's pictures once an answer arrives.
 * A complete answer is the whole truth and replaces what came before, including a picture somebody has since removed.
 * An incomplete one leaves out the members Discord would not talk about rather than saying they have none, so it is laid over what is already known: replacing wholesale would blink a picture found last time back to the account's until a complete answer lands.
 */
export const mergeServerAvatars = (known: ReadonlyMap<string, string>, answer: ServerAvatars): ReadonlyMap<string, string> =>
  answer.complete ? answer.avatars : new Map([...known, ...answer.avatars]);

const GUILDS_URL = 'https://discord.com/api/guilds';

/** Discord refuses with these when the application's bot was never added to the server, and says nothing about the member. */
const GUILD_REFUSALS = new Set([401, 403]);

/** Discord has no record of this person in this server, which is a real answer: there is no per-server picture to find. */
const NO_SUCH_MEMBER = 404;
/**
 * Discord's own code for a guild it will not talk about. A guild sub-route answers it rather than a 403 when the
 * application's bot is not a member, which is the ordinary case: installing an activity in a server adds no bot to it.
 */
const UNKNOWN_GUILD = 10_004;

/**
 * What one member lookup can say.
 * A refusal and an answer are both final; a failure is not, and telling the two apart is what keeps a rate-limited
 * moment from being written down as "this person set no picture" and served for the rest of the room's life.
 */
type Member = { readonly said: 'refused' } | { readonly said: 'answered'; readonly avatar: string | null } | { readonly said: 'failed' };

/**
 * The picture someone set for one server is not in anything the client is told: the participants payload carries the
 * account's avatar and the server nickname, and stops there. Only a member lookup reports it, and only the application's
 * bot may ask.
 */
const memberAvatar = async (botToken: string, guildId: string, user: string): Promise<Member> => {
  try {
    const response = await fetch(`${GUILDS_URL}/${encodeURIComponent(guildId)}/members/${encodeURIComponent(user)}`, {
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });
    if (!response.ok) {
      if (GUILD_REFUSALS.has(response.status)) return { said: 'refused' };
      if (response.status === NO_SUCH_MEMBER) {
        // The status alone does not say which of the two was not found.
        // A guild nobody may ask about refuses for every member at once, so reading it as one member's absence is what sends the rest of the roster after it.
        const named = safeParse(discordErrorSchema, await response.json().catch(() => null));
        if (named.success && named.output.code === UNKNOWN_GUILD) return { said: 'refused' };
        return {
          said: 'answered',
          avatar: null,
        };
      }
      // A rate limit or an outage is Discord declining to say, which is not the same as saying there is nothing.
      return { said: 'failed' };
    }
    const member = safeParse(guildMemberSchema, await response.json().catch(() => null));
    return member.success
      ? {
          said: 'answered',
          avatar: member.output.avatar ?? null,
        }
      : { said: 'failed' };
  } catch {
    // A lookup that never completed says nothing about the member, so the rest are still worth asking.
    return { said: 'failed' };
  }
};

/**
 * Discord meters the member route per server, so a whole room asking at once spends that bucket in a single burst and
 * collects the 429s it could have had as pictures. This is a cap on how hard one roster leans on that bucket, not on
 * what the runtime allows.
 */
const MEMBER_LOOKUPS = 6;

/**
 * Asks about every member exactly once with no more than the cap in flight.
 * One shared walk over the roster hands each worker the next name, so a slow lookup holds up nothing but itself, and the
 * answers are paired with the member they are about because they do not come back in the order they were asked.
 */
const askAbout = async (botToken: string, guildId: string, users: readonly string[]): Promise<readonly (readonly [string, Member])[]> => {
  const remaining = users[Symbol.iterator]();
  const answers: (readonly [string, Member])[] = [];
  const worker = async (): Promise<void> => {
    const next = remaining.next();
    if (next.done === true) return;
    answers.push([next.value, await memberAvatar(botToken, guildId, next.value)]);
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(MEMBER_LOOKUPS, users.length) }, worker));
  return answers;
};

/** The pictures found for one server, and whether Discord actually answered about everyone who was asked after. */
interface ServerAnswer {
  readonly avatars: Record<string, string>;
  readonly complete: boolean;
}

/**
 * The pictures the members of one server set there.
 * The first lookup answers for the server as well as for its member: a refusal means the bot was never added to it, and
 * asking about everyone else would spend the bot's whole rate limit collecting the same refusal — which is not a
 * hypothetical, since running an activity in a server does not put the application's bot in it.
 */
const serverAvatars = async (botToken: string, guildId: string, users: readonly string[]): Promise<ServerAnswer> => {
  const found: Record<string, string> = {};
  // There is always a first member to ask about, because the caller was found among these before this was reached.
  const [first, ...rest] = users;
  const probe = await memberAvatar(botToken, guildId, first);
  // A refusal is a complete answer about this server: the bot may not ask, so there was never anything here to find.
  if (probe.said === 'refused') {
    return {
      avatars: found,
      complete: true,
    };
  }
  // A probe Discord declined to answer is the strongest evidence there is that its bucket is empty, and stopping here is what keeps the fan-out from spending what little is left of it.
  if (probe.said === 'failed') {
    return {
      avatars: found,
      complete: false,
    };
  }
  let complete = true;
  if (probe.avatar !== null) found[first] = probe.avatar;
  for (const [user, member] of await askAbout(botToken, guildId, rest)) {
    if (member.said === 'failed') complete = false;
    else if (member.said === 'answered' && member.avatar !== null) found[user] = member.avatar;
  }
  return {
    avatars: found,
    complete,
  };
};

/**
 * One roster is one answer, however many players ask for it.
 * Without this every player in a room drives their own fan-out on every join, which is cubic in the room and would
 * spend the bot's rate limit — the same limit the token endpoint depends on — on a decoration.
 *
 * The answer is held here rather than in the platform's cache, for two reasons. Cloudflare documents functional cache
 * operations for a Worker on a custom domain and this one is reached on workers.dev; and a response cacheable by the
 * browser or by Discord's proxy would go on answering for a url that names the instance but not who is in it, so a
 * player who joined a moment ago would be missing from it.
 */
const CACHE_MS = 60_000;

interface Answered {
  readonly at: number;
  readonly answer: Promise<ServerAnswer>;
}

const answered = new Map<string, Answered>();

const rosterKey = (instanceId: string, users: readonly string[]): string => `${instanceId}\n${[...users].toSorted().join(',')}`;

/**
 * One roster is one lookup even while it is still running: what is held is the asking rather than the answer, so a burst
 * arriving mid-flight waits on the lookup already out instead of starting its own. A worker's memory is not swept for
 * it, so the rosters that have gone stale are dropped as a new one is recorded.
 */
const askOnce = async (botToken: string, guildId: string, key: string, users: readonly string[], now: number): Promise<ServerAnswer> => {
  const held = answered.get(key);
  if (held !== undefined && now - held.at < CACHE_MS) return await held.answer;
  for (const [past, record] of answered) if (now - record.at >= CACHE_MS) answered.delete(past);
  const answer = (async (): Promise<ServerAnswer> => {
    const found = await serverAvatars(botToken, guildId, users);
    // Only an answer Discord finished is worth holding: the other kind would keep standing in for the members it missed.
    if (!found.complete) answered.delete(key);
    return found;
  })();
  answered.set(key, {
    at: now,
    answer,
  });
  return await answer;
};

/**
 * How long this endpoint may reuse Discord's record of who is in an instance, which is far shorter than how long it may
 * reuse the pictures it found for them. One join wakes every client in the room at once, and each of those asks about
 * the instance on the route the joiner's own token exchange is using, so the joiner is the one who collects the 429 and
 * fails to join over a decoration. A few seconds is long enough to collapse one of those bursts into a single lookup.
 *
 * The two caches cannot be one. The roster answer above is keyed on the sorted list of players precisely so that a new
 * arrival invalidates it and shows up straight away; this one is keyed on the instance alone, which is what collapses a
 * burst but would also hide a new arrival, so it may only live for seconds.
 *
 * The join path is deliberately not given this: createSession asks Discord itself every time, because the roster there
 * decides who is let into a room rather than whose picture is drawn.
 *
 * CHASE_MS is set against this window from the client's side, so shortening it there without shortening this one leaves the chase asking inside the window it was meant to outlast.
 */
const INSTANCE_MS = 5000;

interface Located {
  readonly at: number;
  readonly participants: Promise<ActivityInstance | Response>;
  /**
   * The players a lookup was made on behalf of to arrive at this record, carried forward from the record it replaced.
   * A room token outlives the call it was minted for by six hours, so without this a holder Discord goes on leaving out spends one lookup per request they send, on the bot's own rate limit, which is the limit the join path depends on.
   */
  readonly asked: ReadonlySet<string>;
}

const located = new Map<string, Located>();

/** The record this instance is holding, while it is still young enough for this endpoint to answer from. */
const heldFor = (instanceId: string, now: number): Located | null => {
  const held = located.get(instanceId);
  return held !== undefined && now - held.at < INSTANCE_MS ? held : null;
};

/**
 * A refusal is one Response with one body, and everyone waiting on the same lookup is handed the same object.
 * Whoever reads it first would consume it for the rest, so each caller leaves with its own copy and the shared one is never sent.
 */
const ownCopy = (answer: ActivityInstance | Response): ActivityInstance | Response => (answer instanceof Response ? answer.clone() : answer);

/**
 * Asks Discord who is in the instance on one player's behalf, which is what settles a record too old to be trusted about them.
 * A lookup already made on their behalf against what is held is the answer to this one, whether it has come back yet or not, so a player who is simply not there costs one lookup rather than one per request, and a burst of requests from them costs one between the lot.
 * A lookup that has not been made yet carries those players forward, because the record it writes is the one they are answered against.
 */
const askInstance = async (clientId: string, botToken: string, instanceId: string, now: number, subject: string): Promise<ActivityInstance | Response> => {
  const chain = heldFor(instanceId, now);
  if (chain?.asked.has(subject) === true) return ownCopy(await chain.participants);
  const asked = new Set([...(chain?.asked ?? []), subject]);
  for (const [past, record] of located) if (now - record.at >= INSTANCE_MS) located.delete(past);
  const ask = async (): Promise<ActivityInstance | Response> => {
    try {
      return await lookupInstance(clientId, botToken, instanceId);
    } catch {
      // A lookup that never reached Discord says nothing about who is in the instance, so it answers as an outage rather than failing the request outright.
      return failure('InstanceLookupRejected', 502, 'discord could not be reached');
    }
  };
  const participants = (async (): Promise<ActivityInstance | Response> => {
    const answer = await ask();
    // A refusal must not stand in for a record of the instance, so it is dropped rather than held for the next five seconds.
    if (answer instanceof Response) located.delete(instanceId);
    return answer;
  })();
  located.set(instanceId, {
    at: now,
    participants,
    asked,
  });
  return ownCopy(await participants);
};

/**
 * Discord's record of who is in the instance, reused for the seconds it is good for.
 * Swept on write like the rosters above, since a worker holding one instance forever would hold every instance it ever served.
 * What is held is the lookup rather than its answer, because the burst this exists to collapse arrives while the first lookup is still out: holding the answer would let every client in it miss and ask Discord itself.
 */
const placeInstance = async (clientId: string, botToken: string, instanceId: string, now: number, subject: string): Promise<ActivityInstance | Response> => {
  const held = heldFor(instanceId, now);
  return held === null ? await askInstance(clientId, botToken, instanceId, now, subject) : ownCopy(await held.participants);
};

/**
 * Answers with the per-server picture of everyone in one activity instance.
 * The caller proves they belong to that instance with the room token this worker minted for it, and Discord is asked
 * who is in the instance rather than taking the caller's word, exactly as the token endpoint does.
 */
export const guildAvatars = async (environment: SessionEnvironment, request: Request): Promise<Response> => {
  const clientId = configured(environment.DISCORD_CLIENT_ID);
  const botToken = configured(environment.DISCORD_BOT_TOKEN);
  const sessionSecret = configured(environment.SESSION_HMAC_SECRET);
  if (clientId === null) return failure('MissingDiscordCredentials', 500);
  if (botToken === null || sessionSecret === null) return failure('MissingIdentityCredentials', 500);
  const instanceId = new URL(request.url).searchParams.get('instance');
  const token = bearerToken(request.headers.get('Authorization'));
  if (instanceId === null || token === null) return failure('MissingAuthorization', 401);
  const identity = await verifyRoomToken(sessionSecret, token, instanceId);
  if (identity === null) return failure('MissingAuthorization', 401);
  const now = Date.now();
  const { subject } = identity.player;
  const placed = await placeInstance(clientId, botToken, instanceId, now, subject);
  if (placed instanceof Response) return placed;
  // A room token outlives the call it was minted for, so belonging to the instance is asked again rather than assumed.
  // A held record may be INSTANCE_MS old, which makes a miss against it ambiguous: somebody who joined inside that window is missing from it rather than absent from the call, and the refusal is not one they can retry, since the client asks again only when the participants change.
  // So the miss is put to Discord on this player's behalf, which costs nothing once an ask on their behalf is already held or on its way.
  const participants = placed.users.includes(subject) ? placed : await askInstance(clientId, botToken, instanceId, now, subject);
  if (participants instanceof Response) return participants;
  if (!participants.users.includes(subject)) return failure('NotInInstance', 403);
  const guildId = participants.location?.guild_id ?? null;
  // An activity opened in a direct call belongs to no server, so there is no per-server picture to go looking for.
  if (guildId === null) {
    return Response.json({
      guildId,
      users: participants.users,
      avatars: {},
      complete: true,
    });
  }
  const answer = await askOnce(botToken, guildId, rosterKey(instanceId, participants.users), participants.users, now);
  return Response.json({
    guildId,
    // Named so the caller can tell an answer about its own roster from one about the roster this worker last looked up.
    users: participants.users,
    avatars: answer.avatars,
    complete: answer.complete,
  });
};
