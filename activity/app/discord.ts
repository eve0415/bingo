import type { IDiscordSDK } from '@discord/embedded-app-sdk';

import { playerKey } from '@bingo/wrapper/identity';
import { DiscordSDK, DiscordSDKMock, Events } from '@discord/embedded-app-sdk';
import { safeParse } from 'valibot';

import { ISSUER } from './session';
import { configSchema, failureSchema, sessionSchema } from './token';

// The worker holds the application id, so a deployment configures it in one place rather than baking it into this bundle.
const configuredClientId = async (): Promise<string> => {
  const response = await fetch('/api/config');
  const parsed = safeParse(configSchema, await response.json().catch(() => null));
  if (!parsed.success) throw new Error(`the activity is not configured with a discord client id (${response.status})`);
  return parsed.output.clientId;
};

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
 * The room knows players only as issuer and subject; Discord is the only thing that knows what to call them.
 * The subscription lives as long as the document, like the handshake that opens it, so React reads it as an external store instead of owning it.
 */
export type ParticipantNames = ReadonlyMap<string, string>;

interface Participant {
  id: string;
  username: string;
  global_name?: string | null | undefined;
  nickname?: string | undefined;
}

const namesOf = (participants: readonly Participant[]): ParticipantNames =>
  new Map(
    participants.map(participant => [
      playerKey({
        issuer: ISSUER,
        subject: participant.id,
      }),
      participant.nickname ?? participant.global_name ?? participant.username,
    ]),
  );

let known: ParticipantNames = new Map();
const listeners = new Set<() => void>();

export const participantNames = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  },
  read: (): ParticipantNames => known,
};

const publish = (participants: readonly Participant[]): void => {
  known = namesOf(participants);
  for (const listener of listeners) listener();
};

const watchParticipants = async (sdk: IDiscordSDK): Promise<void> => {
  await sdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, (event: { participants: Participant[] }): void => {
    publish(event.participants);
  });
  const connected = await sdk.commands.getInstanceConnectedParticipants();
  publish(connected.participants);
};

/** Long enough for three round trips to Discord, short enough that a launch which never completes says so instead of waiting. */
const HANDSHAKE_TIMEOUT_MS = 30_000;
/** Names are a courtesy. Waiting for them avoids a fallback label flashing to a real one, but a client that is slow about it must not be felt at every launch. */
const NAMES_TIMEOUT_MS = 1500;

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

const openSession = async (): Promise<ActivitySession> => {
  const id = await configuredClientId();
  const embedded = isEmbedded();
  const sdk = createSdk(id, embedded);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: id,
    response_type: 'code',
    prompt: 'none',
    scope: ['identify'],
  });
  // The mock issues its own code and fabricates the session, so there is nothing for Discord to redeem.
  const exchanged = embedded ? await exchangeCode(code, sdk.instanceId) : null;
  const { user } = await sdk.commands.authenticate({
    access_token: exchanged?.accessToken ?? null,
  });
  try {
    await withDeadline(watchParticipants(sdk), 'the discord client did not report who is here', NAMES_TIMEOUT_MS);
  } catch {
    // A client that will not answer leaves the roster on its fallback labels rather than holding the launch open behind it.
  }
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
