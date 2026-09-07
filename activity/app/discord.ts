import type { ServerAvatars } from './avatars';
import type { PlayerProfile } from './room/profiles';
import type { IDiscordSDK } from '@discord/embedded-app-sdk';

import { playerKey } from '@bingo/wrapper/identity';
import { DiscordSDK, DiscordSDKMock, Events } from '@discord/embedded-app-sdk';
import { safeParse } from 'valibot';

import { avatarUrl, mergeServerAvatars, serverAvatarLookup } from './avatars';
import { ISSUER } from './session';
import { configSchema, failureSchema, sessionSchema } from './token';

// The worker holds the application id, so a deployment configures it in one place rather than baking it into this bundle.
const configuredClientId = async (): Promise<string> => {
  const response = await fetch('/api/config');
  const parsed = safeParse(configSchema, await response.json().catch(() => null));
  if (!parsed.success) throw new Error(`the activity is not configured with a discord client id (${response.status})`);
  return parsed.output.clientId;
};

type AuthorizeScopes = Parameters<IDiscordSDK['commands']['authorize']>[0]['scope'];

export interface ActivityUser {
  id: string;
  displayName: string;
}
/** What the wrapper's front door said about the minted token, which is the only proof it was accepted. */
export interface RoomProbe {
  status: number;
  detail: string;
}
export interface ActivitySession {
  sdk: IDiscordSDK;
  instanceId: string;
  user: ActivityUser;
  /** Absent on the mock path, which has no Discord instance to be a member of. */
  room: RoomProbe | null;
  roomToken: string | null;
}

interface Exchanged {
  accessToken: string;
  roomToken: string;
  user: ActivityUser;
}

// Discord appends frame_id to the iframe URL, and the real SDK throws while constructing without it.
const isEmbedded = (): boolean => new URLSearchParams(globalThis.location.search).has('frame_id');

// The mock is the only browser-tab path, and development alone may reach it: it answers every command with a fabricated session.
// Vite assigns import.meta.hot only in the dev server and a build replaces it with undefined, which also drops the mock from the bundle.
const createSdk = (clientId: string, embedded: boolean): IDiscordSDK => {
  if (embedded) return new DiscordSDK(clientId);
  if (import.meta.hot === undefined) throw new Error('this page runs only as a Discord activity');
  const mock = new DiscordSDKMock(clientId, null, null, null);
  // Nothing else ever fires the mock's ready event, so its ready() would otherwise never settle.
  mock.emitReady();
  return mock;
};

// Same-origin, so it needs no url mapping beyond the one that points the proxy at this worker.
const exchangeCode = async (code: string, instanceId: string): Promise<Exchanged> => {
  const response = await fetch('/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      instanceId,
    }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failed = safeParse(failureSchema, body);
    throw new Error(
      failed.success
        ? `token exchange failed: ${failed.output.error}${failed.output.detail === undefined ? '' : ` (${failed.output.detail})`}`
        : `token exchange failed with ${response.status}`,
    );
  }
  const issued = safeParse(sessionSchema, body);
  if (!issued.success) throw new Error('token exchange returned no session');
  return {
    accessToken: issued.output.access_token,
    roomToken: issued.output.roomToken,
    user: {
      id: issued.output.user.id,
      displayName: issued.output.user.displayName,
    },
  };
};

// Presenting the token to the wrapper is the only way to know it was minted correctly; a room that does not exist yet still means the identity passed.
const probeRoom = async (room: string, token: string): Promise<RoomProbe> => {
  const response = await fetch(`/rooms/${encodeURIComponent(room)}/state`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const failed = safeParse(failureSchema, await response.json().catch(() => null));
  return {
    status: response.status,
    detail: failed.success ? failed.output.error : 'accepted',
  };
};

/**
 * The room knows players only as issuer and subject; Discord is the only thing that knows what to call them or what they look like.
 * The subscription lives as long as the document, like the handshake that opens it, so React reads it as an external store instead of owning it.
 */
export type ParticipantProfiles = ReadonlyMap<string, PlayerProfile>;

interface Participant {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string | null | undefined;
  global_name?: string | null | undefined;
  nickname?: string | undefined;
}

/**
 * The server this activity was opened in and the pictures its members set there, both as the worker resolved them from
 * Discord's own record of the instance. They arrive a round trip after the roster does, so the first paint shows
 * account pictures and this replaces them.
 */
let guild: string | null = null;
let serverAvatars: ReadonlyMap<string, string> = new Map();

const profilesOf = (participants: readonly Participant[]): ParticipantProfiles =>
  new Map(
    participants.map(participant => [
      playerKey({
        issuer: ISSUER,
        subject: participant.id,
      }),
      {
        name: participant.nickname ?? participant.global_name ?? participant.username,
        avatar: avatarUrl({
          id: participant.id,
          avatar: participant.avatar ?? null,
          discriminator: participant.discriminator,
          guildId: guild,
          guildAvatar: serverAvatars.get(participant.id) ?? null,
        }),
      },
    ]),
  );

let known: ParticipantProfiles = new Map();
const listeners = new Set<() => void>();

export const participantProfiles = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  },
  read: (): ParticipantProfiles => known,
};

let here: readonly Participant[] = [];

const publish = (participants: readonly Participant[]): void => {
  here = participants;
  known = profilesOf(participants);
  for (const listener of listeners) listener();
};

/** The lookup this launch may make, which exists only on the embedded path; the mock has no worker to ask. */
let lookup: ((ids: readonly string[]) => Promise<ServerAvatars | null>) | null = null;

const chaseServerAvatars = async (): Promise<void> => {
  if (lookup === null) return;
  const answer: ServerAvatars | null = await lookup(here.map(participant => participant.id));
  if (answer === null) return;
  guild = answer.guildId;
  serverAvatars = mergeServerAvatars(serverAvatars, answer);
  publish(here);
};

/** Lookups are queued rather than raced, so an older answer can never land on top of a newer one. */
let chasing: Promise<void> = Promise.resolve();

/** Starts a lookup and returns without it, because the launch screen must never hold for a picture. */
const chase = (): void => {
  const previous = chasing;
  chasing = (async (): Promise<void> => {
    await previous;
    await chaseServerAvatars();
  })();
};

const watchParticipants = async (sdk: IDiscordSDK): Promise<void> => {
  await sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, (event: { participants: Participant[] }): void => {
    publish(event.participants);
    chase();
  });
  const connected = await sdk.commands.getInstanceConnectedParticipants();
  publish(connected.participants);
  chase();
};

/** The waits openSession performs, in the order it performs them; the launch screen names the one it is on. */
export type BootStep = 'config' | 'discord' | 'identity' | 'participants' | 'room';

let reached: BootStep = 'config';
const watching = new Set<() => void>();

/** The handshake is not a React value either, so its progress is read as an external store like the roster above. */
export const bootProgress = {
  subscribe: (listener: () => void): (() => void) => {
    watching.add(listener);
    return (): void => {
      watching.delete(listener);
    };
  },
  read: (): BootStep => reached,
};

// A launch that is retried in a new document starts a new module, so the step only ever moves forward.
const reach = (step: BootStep): void => {
  reached = step;
  for (const listener of watching) listener();
};

/** Long enough for three round trips to Discord, short enough that a launch which never completes says so instead of waiting. */
const HANDSHAKE_TIMEOUT_MS = 30_000;
/** Profiles are a courtesy. Waiting for them avoids a fallback label flashing to a real one, but neither the client nor the picture lookup may be felt at every launch; whatever the deadline cuts short still lands on the roster afterwards. */
const PROFILES_TIMEOUT_MS = 1500;

// A client that never answers leaves ready() pending forever, and a pending promise under Suspense is a page that never stops joining.
const withDeadline = async <T>(work: Promise<T>, message: string, limit = HANDSHAKE_TIMEOUT_MS): Promise<T> => {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    reject(new Error(message));
  }, limit);
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Discord's OAuth2 scope table calls rpc.activities.write partner-only while the Activities docs hand it out freely, and prompt: 'none' refuses a scope needing consent rather than asking for it.
 * The profile card is a courtesy, so a client that will not grant it must still be able to open the room: the second attempt asks for the identity alone and lets setActivity fail on its own.
 */
const authorize = async (sdk: IDiscordSDK, id: string): Promise<string> => {
  const ask = async (scope: AuthorizeScopes): Promise<string> => {
    const granted = await sdk.commands.authorize({
      client_id: id,
      response_type: 'code',
      prompt: 'none',
      scope,
    });
    return granted.code;
  };
  try {
    return await ask(['identify', 'rpc.activities.write']);
  } catch {
    return await ask(['identify']);
  }
};

const openSession = async (): Promise<ActivitySession> => {
  const id = await configuredClientId();
  reach('discord');
  const embedded = isEmbedded();
  const sdk = createSdk(id, embedded);
  await sdk.ready();
  reach('identity');
  const code = await authorize(sdk, id);
  // The mock issues its own code and fabricates the session, so there is nothing for Discord to redeem.
  const exchanged = embedded ? await exchangeCode(code, sdk.instanceId) : null;
  const authenticated = await sdk.commands.authenticate({
    access_token: exchanged?.accessToken ?? null,
  });
  const { user, scopes } = authenticated;
  // The fallback above gives up the scope the profile card needs without saying so, and nothing downstream can tell that apart from a card Discord simply declined to draw.
  if (!scopes.includes('rpc.activities.write')) console.warn('bingo: launched without rpc.activities.write, so no profile card will be set');
  reach('participants');
  // A question the lookup leaves open is chased by the same queue a participants update goes through, so an answer that lands late can never overtake a newer one.
  if (exchanged !== null) lookup = serverAvatarLookup(sdk.instanceId, exchanged.roomToken, chase);
  try {
    await withDeadline(watchParticipants(sdk), 'the discord client did not report who is here', PROFILES_TIMEOUT_MS);
  } catch {
    // A client that will not answer leaves the roster on its fallback labels rather than holding the launch open behind it.
  }
  reach('room');
  return {
    sdk,
    instanceId: sdk.instanceId,
    // Embedded, the identity is the one the worker read from Discord; the mock has no such source and reports its own.
    user: exchanged?.user ?? {
      id: user.id,
      displayName: user.global_name ?? user.username,
    },
    room: exchanged === null ? null : await probeRoom(sdk.instanceId, exchanged.roomToken),
    roomToken: exchanged?.roomToken ?? null,
  };
};

// Discord authorizes a launch once, and React may run a state initializer more than once, so the handshake is started at most once per document.
let started: Promise<ActivitySession> | null = null;
export const activitySession = async (): Promise<ActivitySession> =>
  (started ??= withDeadline(openSession(), 'the discord client did not finish opening this activity'));
