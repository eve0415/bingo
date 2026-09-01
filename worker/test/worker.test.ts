import type { GameLogResponse, ServerMessage } from '../src/protocol';
import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';

import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env as workerEnv, exports as workerExports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import * as engine from '../src/engine';
import { ROOM_KEY_HEADER, ROOM_MODE_HEADER, VERIFIED_IDENTITY_HEADER, decodeIdentity, encodeIdentity, verifyIdentity } from '../src/identity';
import app from '../src/index';
import { Room } from '../src/room';
import { DEADLINE_HORIZONS, MAX_PLAYERS } from '../src/settings';

const SECRET = 'test-secret';
const AUTH_ROOM = 'auth';
const DEFAULT_JWT_HEADER: Record<string, unknown> = {
  alg: 'HS256',
};
let roomCounter = 0;
interface Claims {
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  room?: unknown;
  name?: unknown;
}
interface TestClient {
  socket: WebSocket;
  frames: string[];
  next: () => Promise<string>;
  send: (value: unknown) => void;
  close: () => Promise<void>;
}
const roomName = (label: string): string => {
  roomCounter += 1;
  return `${label}-${roomCounter}`;
};
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const encodePart = (value: unknown): string => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
const token = async (claims: Claims = {}, header: Record<string, unknown> = DEFAULT_JWT_HEADER, secret = SECRET): Promise<string> => {
  const completeClaims = {
    iss: 'hmac',
    sub: 'host',
    exp: Math.floor(Date.now() / 1000) + 3600,
    room: AUTH_ROOM,
    ...claims,
  };
  const encodedHeader = encodePart(header);
  const encodedClaims = encodePart(completeClaims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${bytesToBase64Url(signature)}`;
};
const auth = async (room: string, subject = 'host', issuer = 'hmac', name?: string): Promise<string> =>
  `Bearer ${await token({
    iss: issuer,
    sub: subject,
    room,
    name,
  })}`;
const openClient = async (room: string, subject = 'host', extraHeaders: HeadersInit = {}, displayName?: string): Promise<TestClient> => {
  const headers = new Headers(extraHeaders);
  headers.set('Upgrade', 'websocket');
  headers.set('Authorization', await auth(room, subject, 'hmac', displayName));
  const response = await workerExports.default.fetch(`https://example.test/rooms/${room}/ws`, {
    headers,
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error('websocket response is missing its socket');
  }
  const frames: string[] = [];
  const waiters: ((value: string) => void)[] = [];
  socket.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    const waiter = waiters.shift();
    if (waiter === undefined) frames.push(event.data);
    else waiter(event.data);
  });
  socket.accept();
  return {
    socket,
    frames,
    next: async () => {
      const frame = frames.shift();
      if (frame !== undefined) return frame;
      return new Promise<string>(resolve => {
        waiters.push(resolve);
      });
    },
    send: value => {
      socket.send(JSON.stringify(value));
    },
    close: async () => {
      socket.close(1000, 'test complete');
      await Promise.resolve();
    },
  };
};
const parseServerMessage = (value: string): ServerMessage => JSON.parse(value);
const nextMessage = async (client: TestClient): Promise<ServerMessage> => parseServerMessage(await client.next());
const fetchGameLog = async (room: string, gameIndex: number, subject = 'host'): Promise<Response> =>
  workerExports.default.fetch(`https://example.test/rooms/${room}/games/${gameIndex}/log`, {
    headers: {
      Authorization: await auth(room, subject),
    },
  });
const nextSnapshot = async (
  client: TestClient,
): Promise<
  Extract<
    ServerMessage,
    {
      type: 'snapshot';
    }
  >
> => {
  const message = await nextMessage(client);
  if (message.type !== 'snapshot') {
    throw new Error(`expected snapshot, received ${message.type}`);
  }
  return message;
};
const nextSnapshotAfterResync = async (
  client: TestClient,
): Promise<
  Extract<
    ServerMessage,
    {
      type: 'snapshot';
    }
  >
> => {
  client.send({
    type: 'resync',
  });
  return nextSnapshot(client);
};
const accepted = async (
  client: TestClient,
): Promise<{
  snapshot: Extract<
    ServerMessage,
    {
      type: 'snapshot';
    }
  >;
  events: Extract<
    ServerMessage,
    {
      type: 'events';
    }
  >;
}> => {
  const snapshot = await nextMessage(client);
  const events = await nextMessage(client);
  if (snapshot.type !== 'snapshot' || events.type !== 'events') {
    throw new Error('accepted command did not produce snapshot and event frames');
  }
  return {
    snapshot,
    events,
  };
};
const replacementAccepted = async (client: TestClient): ReturnType<typeof accepted> => {
  await accepted(client);
  return accepted(client);
};
const errorMessage = async (
  client: TestClient,
): Promise<
  Extract<
    ServerMessage,
    {
      type: 'error';
    }
  >
> => {
  const message = await nextMessage(client);
  if (message.type !== 'error') {
    throw new Error(`expected error, received ${message.type}`);
  }
  return message;
};
const rosterCount = async (room: string): Promise<number> => {
  const stub = workerEnv.ROOM.getByName(room);
  return runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<{
        count: number;
      }>('SELECT COUNT(*) AS count FROM roster')
      .toArray()
      .at(0);
    return row?.count ?? -1;
  });
};
const storedSnapshot = async (room: string): Promise<string> => {
  const stub = workerEnv.ROOM.getByName(room);
  return runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<{
        blob: string;
      }>('SELECT blob FROM snapshot ORDER BY game_ix DESC LIMIT 1')
      .toArray()
      .at(0);
    return row?.blob ?? '';
  });
};
const storedSeed = async (room: string): Promise<string> => {
  const stub = workerEnv.ROOM.getByName(room);
  return runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<{
        seed: string;
      }>('SELECT seed FROM games ORDER BY game_ix DESC LIMIT 1')
      .toArray()
      .at(0);
    return row?.seed ?? '';
  });
};
const deadlineAt = async (room: string, kind: string): Promise<number | null> =>
  runInDurableObject(
    workerEnv.ROOM.getByName(room),
    (_instance, state) =>
      state.storage.sql
        .exec<{
          at: number;
        }>('SELECT at FROM deadlines WHERE kind = ?', kind)
        .toArray()
        .at(0)?.at ?? null,
  );
const rosterDisplayName = async (room: string, subject: string): Promise<string | null> =>
  runInDurableObject(
    workerEnv.ROOM.getByName(room),
    (_instance, state) =>
      state.storage.sql
        .exec<{
          display_name: string;
        }>('SELECT display_name FROM roster WHERE subject = ?', subject)
        .toArray()
        .at(0)?.display_name ?? null,
  );
const OPEN_CONFIG: ConfigDto = {
  size: 5,
  freeCenter: true,
  patterns: [],
  daub: 'Auto',
  winDetection: 'Auto',
  lateJoin: 'Open',
  winLimit: 'Unlimited',
  cardsPerPlayer: 1,
};
const prepareManualAnalysis = async (room: string): Promise<{ host: TestClient; alice: TestClient }> => {
  const host = await openClient(room);
  await nextSnapshot(host);
  host.send({
    type: 'newGame',
    config: {
      ...OPEN_CONFIG,
      freeCenter: false,
      patterns: [[0], [1, 2]],
      daub: 'Manual',
      winDetection: 'Claim',
    },
  });
  await replacementAccepted(host);
  const alice = await openClient(room, 'alice');
  await accepted(alice);
  await accepted(host);
  host.send({
    type: 'command',
    command: 'Start',
  });
  await accepted(host);
  const startedAlice = await accepted(alice);
  const targets = startedAlice.snapshot.view.cards[0].cells.slice(0, 2);
  let drawn: number[] = [];
  for (let draw = 0; draw < 75 && !targets.every(number => drawn.includes(number)); draw += 1) {
    host.send({
      type: 'command',
      command: 'Draw',
    });
    const hostResult = await accepted(host);
    await accepted(alice);
    ({ drawn } = hostResult.snapshot.view);
  }
  expect(targets.every(number => drawn.includes(number))).toBe(true);
  for (const position of [0, 1]) {
    alice.send({
      type: 'command',
      command: {
        Mark: {
          cardIx: 0,
          row: 0,
          col: position,
        },
      },
    });
    const hostResult = await accepted(host);
    const aliceResult = await accepted(alice);
    expect(hostResult.events.events.some(event => 'MarkPlaced' in event)).toBe(true);
    expect(aliceResult.events.events.some(event => 'MarkPlaced' in event)).toBe(true);
  }
  return {
    host,
    alice,
  };
};
const expectRestrictedMarkEvent = async (host: TestClient, alice: TestClient, kind: string, command: CommandDto): Promise<void> => {
  alice.send({
    type: 'command',
    command,
  });
  const hostResult = await accepted(host);
  const aliceResult = await accepted(alice);
  expect(hostResult.events.events.some(event => kind in event)).toBe(false);
  expect(aliceResult.events.events.some(event => kind in event)).toBe(true);
};
const recognizedWinFor = (events: EventDto[], subject: string): EventDto | undefined =>
  events.find(event => 'WinRecognized' in event && event.WinRecognized.winners.some(player => player.subject === subject));
const DEFAULT_PLAYER: PlayerIdDto = {
  issuer: 'hmac',
  subject: 'host',
};
const internalRequest = (room: string, player: PlayerIdDto = DEFAULT_PLAYER, upgrade = false): Request => {
  const headers = new Headers({
    [VERIFIED_IDENTITY_HEADER]: encodeIdentity({
      player,
      displayName: player.subject,
    }),
    [ROOM_KEY_HEADER]: room,
    [ROOM_MODE_HEADER]: upgrade ? 'websocket' : 'state',
  });
  if (upgrade) headers.set('Upgrade', 'websocket');
  return new Request('https://room.internal/', {
    headers,
  });
};
const replaceDeadlines = async (room: string, entries: [string, number][]): Promise<void> => {
  const stub = workerEnv.ROOM.getByName(room);
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec('DELETE FROM deadlines');
    for (const [kind, at] of entries) {
      state.storage.sql.exec('INSERT INTO deadlines (kind, at) VALUES (?, ?)', kind, at);
    }
    await state.storage.setAlarm(Date.now() + 60_000);
  });
};
describe('front door identity', () => {
  it('serves health and requires websocket upgrades', async () => {
    const health = await workerExports.default.fetch('https://example.test/health');
    expect(await health.json()).toEqual({
      ok: true,
    });
    const response = await workerExports.default.fetch('https://example.test/rooms/a/ws');
    expect(response.status).toBe(426);
  });
  it('uses the route-selected mode when a state request carries Upgrade', async () => {
    const room = roomName('state-upgrade');
    const response = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        Authorization: await auth(room),
        Upgrade: 'websocket',
      },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'RoomNotFound',
    });
    const counts = await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => ({
      games: state.storage.sql
        .exec<{
          count: number;
        }>('SELECT COUNT(*) AS count FROM games')
        .one().count,
      events: state.storage.sql
        .exec<{
          count: number;
        }>('SELECT COUNT(*) AS count FROM events')
        .one().count,
    }));
    expect(counts).toEqual({
      games: 0,
      events: 0,
    });
  });
  it('accepts a browser assertion as the selected websocket protocol', async () => {
    const room = roomName('browser');
    const assertion = await token({
      sub: 'browser',
      room,
    });
    const response = await workerExports.default.fetch(`https://example.test/rooms/${room}/ws`, {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': assertion,
      },
    });
    expect(response.status).toBe(101);
    expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(assertion);
    const socket = response.webSocket;
    if (socket === null) throw new Error('browser socket is missing');
    socket.accept();
    socket.close(1000, 'complete');
  });
  it('rejects decoded room ids that are unsafe for internal headers', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/bad%0Aroom/state', {
      headers: {
        Authorization: await auth('bad\nroom'),
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'InvalidRoomId',
    });
  });
  it.each([
    ['absent', undefined, 'MissingAuthorization'],
    ['malformed header', 'Basic value', 'MissingAuthorization'],
    ['malformed token', 'Bearer broken', 'MalformedToken'],
  ])('rejects %s authorization', async (_label, authorization, code) => {
    const headers = new Headers({
      Upgrade: 'websocket',
    });
    if (authorization !== undefined) {
      headers.set('Authorization', authorization);
    }
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: code,
    });
  });
  it('rejects an unknown issuer', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        Upgrade: 'websocket',
        Authorization: await auth(AUTH_ROOM, 'host', 'unknown'),
      },
    });
    expect(await response.json()).toEqual({
      error: 'UnknownIssuer',
    });
  });
  it('rejects a bad signature', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        Upgrade: 'websocket',
        Authorization: `Bearer ${await token(
          {},
          {
            alg: 'HS256',
          },
          'wrong-secret',
        )}`,
      },
    });
    expect(await response.json()).toEqual({
      error: 'BadSignature',
    });
  });
  it('rejects an expired token', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        Upgrade: 'websocket',
        Authorization: `Bearer ${await token({
          exp: 1,
        })}`,
      },
    });
    expect(await response.json()).toEqual({
      error: 'ExpiredToken',
    });
  });
  it('rejects a token minted for another room', async () => {
    const response = await workerExports.default.fetch(`https://example.test/rooms/${roomName('other')}/ws`, {
      headers: {
        Upgrade: 'websocket',
        Authorization: await auth(AUTH_ROOM),
      },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'RoomMismatch',
    });
  });
  it('rejects a token claiming another algorithm', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        Upgrade: 'websocket',
        Authorization: `Bearer ${await token(
          {},
          {
            alg: 'none',
          },
        )}`,
      },
    });
    expect(await response.json()).toEqual({
      error: 'UnsupportedAlgorithm',
    });
  });
  it('rejects a token without a subject', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        Upgrade: 'websocket',
        Authorization: `Bearer ${await token({
          sub: undefined,
        })}`,
      },
    });
    expect(await response.json()).toEqual({
      error: 'InvalidClaims',
    });
  });
  it('overwrites a forged verified-identity header', async () => {
    const room = roomName('forged');
    const forged = encodeIdentity({
      player: {
        issuer: 'hmac',
        subject: 'attacker',
      },
      displayName: 'attacker',
    });
    const client = await openClient(room, 'alice', {
      [VERIFIED_IDENTITY_HEADER]: forged,
    });
    const snapshot = await nextSnapshot(client);
    expect(snapshot.view.host.subject).toBe('alice');
    expect(snapshot.view.cards.map(card => card.owner.subject)).toEqual(['alice']);
  });
  it('rejects corrupt compact-token encodings and claim types', async () => {
    const goodClaims = encodePart({
      iss: 'hmac',
      sub: 'host',
      exp: Math.floor(Date.now() / 1000) + 60,
      room: AUTH_ROOM,
    });
    const goodHeader = encodePart({
      alg: 'HS256',
    });
    const cases: [string, string][] = [
      ['Bearer %%%.e30.x', 'UnsupportedAlgorithm'],
      ['Bearer eA.e30.x', 'UnsupportedAlgorithm'],
      ['Bearer .e30.x', 'MalformedToken'],
      [`Bearer ${goodHeader}.${goodClaims}.*`, 'MalformedToken'],
      [
        `Bearer ${await token(
          {},
          {
            alg: 4,
          },
        )}`,
        'UnsupportedAlgorithm',
      ],
      [
        `Bearer ${await token({
          iss: 4,
        })}`,
        'InvalidClaims',
      ],
      [
        `Bearer ${await token({
          sub: '',
        })}`,
        'InvalidClaims',
      ],
      [
        `Bearer ${await token({
          sub: 'a'.repeat(257),
        })}`,
        'InvalidClaims',
      ],
      [
        `Bearer ${await token({
          exp: 'soon',
        })}`,
        'InvalidClaims',
      ],
      [
        `Bearer ${await token({
          room: undefined,
        })}`,
        'InvalidClaims',
      ],
    ];
    for (const [authorization, code] of cases) {
      expect(
        await verifyIdentity(authorization, AUTH_ROOM, {
          hmac: SECRET,
        }),
      ).toEqual({
        ok: false,
        code,
      });
    }
    const named = await verifyIdentity(
      `Bearer ${await token({
        name: 'Host Name',
      })}`,
      AUTH_ROOM,
      {
        hmac: SECRET,
      },
    );
    expect(named.ok && named.identity.displayName).toBe('Host Name');
    const unnamed = await verifyIdentity(
      `Bearer ${await token({
        name: '',
      })}`,
      AUTH_ROOM,
      {
        hmac: SECRET,
      },
    );
    expect(unnamed.ok && unnamed.identity.displayName).toBe('host');
    // Issuers that emit a null display name must still authenticate, falling back to the subject as any non-string value does.
    const nullName = await verifyIdentity(
      `Bearer ${await token({
        name: null,
      })}`,
      AUTH_ROOM,
      {
        hmac: SECRET,
      },
    );
    expect(nullName.ok && nullName.identity.displayName).toBe('host');
  });
  it('bounds display names before forwarding an identity to a room', async () => {
    const acceptedName = await verifyIdentity(
      `Bearer ${await token({
        name: 'a'.repeat(256),
      })}`,
      AUTH_ROOM,
      {
        hmac: SECRET,
      },
    );
    expect(acceptedName.ok && acceptedName.identity.displayName).toHaveLength(256);
    const oversizedDisplayName = `${'a'.repeat(256)}日`;
    const rejectedName = await verifyIdentity(
      `Bearer ${await token({
        name: oversizedDisplayName,
      })}`,
      AUTH_ROOM,
      {
        hmac: SECRET,
      },
    );
    expect(rejectedName).toEqual({
      ok: false,
      code: 'InvalidClaims',
    });
  });
  it('reports a missing issuer-bound signing secret', async () => {
    const authorization = `Bearer ${await token()}`;
    expect(
      await verifyIdentity(authorization, AUTH_ROOM, {
        hmac: undefined,
      }),
    ).toEqual({
      ok: false,
      code: 'MissingIdentitySecret',
    });
    expect(
      await verifyIdentity(authorization, AUTH_ROOM, {
        hmac: '',
      }),
    ).toEqual({
      ok: false,
      code: 'MissingIdentitySecret',
    });
    const response = await app.request(
      'https://example.test/rooms/auth/state',
      {
        headers: {
          Authorization: authorization,
        },
      },
      {
        ROOM: workerEnv.ROOM,
      },
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'MissingIdentitySecret',
    });
  });
  it('rejects malformed internal identity encodings', () => {
    expect(decodeIdentity(null)).toBeNull();
    expect(decodeIdentity('{')).toBeNull();
    for (const value of [
      null,
      {},
      {
        player: null,
        displayName: 'name',
      },
      {
        player: {
          issuer: 1,
          subject: 'subject',
        },
        displayName: 'name',
      },
      {
        player: {
          issuer: 'hmac',
          subject: 1,
        },
        displayName: 'name',
      },
      {
        player: {
          issuer: 'hmac',
          subject: 'subject',
        },
        displayName: 1,
      },
    ]) {
      expect(decodeIdentity(JSON.stringify(value))).toBeNull();
    }
  });
});
describe('room games and projections', () => {
  it("keeps the roster and changes a player's card for a new game", async () => {
    const room = roomName('new-game');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    const awaitedResult1 = await nextSnapshotAfterResync(alice);
    const before = awaitedResult1.view.cards[0]?.cells;
    const oldSeed = await storedSeed(room);
    expect(await rosterCount(room)).toBe(2);
    host.send({
      type: 'newGame',
      config: null,
    });
    const closedHost = await accepted(host);
    const closedAlice = await accepted(alice);
    expect(closedHost.snapshot.room.gameIndex).toBe(0);
    expect(closedHost.snapshot.view.revealedSeed).toBe(oldSeed);
    expect(closedAlice.snapshot.view.revealedSeed).toBe(oldSeed);
    const replacementHost = await accepted(host);
    const replacementAlice = await accepted(alice);
    expect(replacementHost.snapshot.room.gameIndex).toBe(1);
    const after = replacementAlice.snapshot.view.cards[0]?.cells;
    expect(after).not.toEqual(before);
    expect(await rosterCount(room)).toBe(2);
  });
  it("restores a player's card and marks through a fresh object instance", async () => {
    const room = roomName('wake');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'command',
      command: 'Draw',
    });
    await accepted(host);
    const awaitedResult2 = await accepted(alice);
    const before = awaitedResult2.snapshot.view.cards;
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      const fresh = new Room(state, workerEnv);
      const aliceSocket = state.getWebSockets().find(socket => {
        const attachment: unknown = socket.deserializeAttachment();
        return (
          typeof attachment === 'object' &&
          attachment !== null &&
          'player' in attachment &&
          typeof attachment.player === 'object' &&
          attachment.player !== null &&
          'subject' in attachment.player &&
          attachment.player.subject === 'alice'
        );
      });
      if (aliceSocket === undefined) throw new Error('alice socket is missing');
      fresh.webSocketMessage(
        aliceSocket,
        JSON.stringify({
          type: 'resync',
        }),
      );
    });
    const awaitedResult3 = await nextSnapshot(alice);
    const after = awaitedResult3.view.cards;
    expect(after).toEqual(before);
  });
  it('never emits a running seed and removes hidden draw data from raw frames', async () => {
    const room = roomName('hidden');
    const host = await openClient(room);
    await nextSnapshot(host);
    const seed = await storedSeed(room);
    host.send({
      type: 'settings',
      settings: {
        drawnVisibility: 'Hidden',
      },
    });
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    const startSnapshot = await host.next();
    const startEvents = await host.next();
    expect(startSnapshot).not.toContain(seed);
    expect(startEvents).not.toContain(seed);
    host.send({
      type: 'command',
      command: 'Draw',
    });
    const rawSnapshot = await host.next();
    const rawEvents = await host.next();
    expect(rawSnapshot).not.toContain(seed);
    expect(rawEvents).not.toContain(seed);
    const snapshot = parseServerMessage(rawSnapshot);
    const events = parseServerMessage(rawEvents);
    expect(snapshot.type === 'snapshot' && snapshot.view.drawn).toEqual([]);
    expect(snapshot.type === 'snapshot' && snapshot.drawnOrder).toEqual([]);
    expect(events.type === 'events' && events.drawnOrder).toEqual([]);
    expect(rawEvents).not.toContain('NumberDrawn');
    expect(rawEvents).not.toContain('MarkPlaced');
    await host.close();
    const reconnected = await openClient(room);
    const reconnectFrame = await reconnected.next();
    const reconnect = parseServerMessage(reconnectFrame);
    expect(reconnect.type === 'snapshot' && reconnect.view.drawn).toEqual([]);
    expect(reconnect.type === 'snapshot' && reconnect.drawnOrder).toEqual([]);
    expect(reconnectFrame).not.toContain(seed);
  });
  it("redacts another player's running marks, analysis, mark events, and win masks", async () => {
    const room = roomName('hidden-analysis');
    const { host, alice } = await prepareManualAnalysis(room);
    const fullHost = await nextSnapshotAfterResync(host);
    const fullAlice = await nextSnapshotAfterResync(alice);
    const fullForeignCard = fullHost.view.cards.find(card => card.owner.subject === 'alice');
    expect(fullForeignCard).toMatchObject({
      marked: fullAlice.view.cards[0].marked,
      bingo: [[0]],
      reach: [[1, 2]],
    });
    host.send({
      type: 'settings',
      settings: {
        drawnVisibility: 'Hidden',
      },
    });
    const restrictedHost = await accepted(host);
    const restrictedAlice = await accepted(alice);
    const restrictedForeignCard = restrictedHost.snapshot.view.cards.find(card => card.owner.subject === 'alice');
    expect(restrictedForeignCard).toMatchObject({
      marked: [],
      bingo: [],
      reach: [],
    });
    expect(restrictedAlice.snapshot.view.cards[0]).toMatchObject({
      bingo: [[0]],
      reach: [[1, 2]],
    });
    await expectRestrictedMarkEvent(host, alice, 'MarkRemoved', {
      Unmark: {
        cardIx: 0,
        row: 0,
        col: 1,
      },
    });
    await expectRestrictedMarkEvent(host, alice, 'MarkPlaced', {
      Mark: {
        cardIx: 0,
        row: 0,
        col: 1,
      },
    });
    alice.send({
      type: 'command',
      command: {
        Claim: {
          cardIx: 0,
        },
      },
    });
    const winningHost = await accepted(host);
    const winningAlice = await accepted(alice);
    expect(winningHost.snapshot.view.phase).toBe('Running');
    expect(winningHost.snapshot.view.wins[0].winners.map(player => player.subject)).toEqual(['alice']);
    expect(winningHost.snapshot.view.wins[0].patterns).toEqual([]);
    expect(winningAlice.snapshot.view.wins[0].patterns).toEqual([[0]]);
    expect(recognizedWinFor(winningHost.events.events, 'alice')).toEqual(recognizedWinFor(winningAlice.events.events, 'alice'));
    host.send({
      type: 'command',
      command: 'Close',
    });
    const finishedHost = await accepted(host);
    const finishedAlice = await accepted(alice);
    expect(finishedHost.snapshot.view.phase).toBe('Finished');
    expect(finishedHost.snapshot.view.cards.find(card => card.owner.subject === 'alice')).toEqual(finishedAlice.snapshot.view.cards[0]);
    expect(finishedHost.snapshot.view.wins).toEqual(finishedAlice.snapshot.view.wins);
  });
  it('rebuilds a deleted snapshot cache before rejecting a state-preserving command', async () => {
    const room = roomName('replay');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    const before = await storedSnapshot(room);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('DELETE FROM snapshot');
    });
    alice.send({
      type: 'command',
      command: 'Draw',
    });
    const awaitedResult4 = await errorMessage(alice);
    expect(awaitedResult4.code).toBe('NotHost');
    expect(await storedSnapshot(room)).toBe(before);
  });
  it('rebuilds snapshot and incremental game state through an undone draw', async () => {
    const room = roomName('cache-replay');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Draw',
    });
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Draw',
    });
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Undo',
    });
    const awaitedResult5 = await accepted(host);
    const before = awaitedResult5.snapshot;
    await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => {
      state.storage.sql.exec('DELETE FROM snapshot');
      state.storage.sql.exec('DELETE FROM game_cache');
    });
    const rebuilt = await nextSnapshotAfterResync(host);
    expect(rebuilt).toEqual(before);
    expect(
      await runInDurableObject(
        workerEnv.ROOM.getByName(room),
        (_instance, state) =>
          state.storage.sql
            .exec<{
              count: number;
            }>('SELECT COUNT(*) AS count FROM game_cache')
            .one().count,
      ),
    ).toBe(1);
  });
  it('returns precise engine errors without changing stored state', async () => {
    const room = roomName('errors');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'newGame',
      config: {
        ...OPEN_CONFIG,
        daub: 'Manual',
        lateJoin: 'Closed',
      },
    });
    await replacementAccepted(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    const beforeDraw = await storedSnapshot(room);
    alice.send({
      type: 'command',
      command: 'Draw',
    });
    const awaitedResult6 = await errorMessage(alice);
    expect(awaitedResult6.code).toBe('NotHost');
    expect(await storedSnapshot(room)).toBe(beforeDraw);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    const beforeMark = await storedSnapshot(room);
    alice.send({
      type: 'command',
      command: {
        Mark: {
          cardIx: 0,
          row: 99,
          col: 99,
        },
      },
    });
    const awaitedResult7 = await errorMessage(alice);
    expect(awaitedResult7.code).toBe('NoSuchPosition');
    expect(await storedSnapshot(room)).toBe(beforeMark);
  });
  it('binds the players present at start for the first game and a later game', async () => {
    const room = roomName('start-rosters');
    const host = await openClient(room);
    const firstLobby = await nextSnapshot(host);
    expect(firstLobby.room.commitment).toBeNull();
    expect(firstLobby.room.commitmentConfig).toBeNull();
    expect(firstLobby.room.commitmentRoster).toBeNull();
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    const firstStarted = await accepted(host);
    await accepted(alice);
    if (firstStarted.snapshot.room.commitment === null) throw new Error('first game did not publish its commitment at start');
    expect(firstStarted.snapshot.room.commitmentRoster.map(player => player.subject)).toEqual(['host', 'alice']);
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'newGame',
      config: null,
    });
    const laterLobby = await accepted(host);
    await accepted(alice);
    expect(laterLobby.snapshot.room.commitment).toBeNull();
    expect(laterLobby.snapshot.room.commitmentConfig).toBeNull();
    expect(laterLobby.snapshot.room.commitmentRoster).toBeNull();
    const bob = await openClient(room, 'bob');
    await accepted(bob);
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'command',
      command: 'Start',
    });
    const laterStarted = await accepted(host);
    await accepted(alice);
    await accepted(bob);
    if (laterStarted.snapshot.room.commitment === null) throw new Error('later game did not publish its commitment at start');
    expect(laterStarted.snapshot.room.commitmentRoster.map(player => player.subject)).toEqual(['host', 'alice', 'bob']);
  });
  it('publishes every pinned commitment input and recomputes its digest after reveal', async () => {
    const room = roomName('commitment');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'newGame',
      config: OPEN_CONFIG,
    });
    const initial = await replacementAccepted(host);
    expect(initial.snapshot.room.roomId).toBe(room);
    expect(initial.snapshot.room.commitment).toBeNull();
    expect(initial.snapshot.room.commitmentConfig).toBeNull();
    expect(initial.snapshot.room.commitmentRoster).toBeNull();
    expect(initial.snapshot.view.config.patterns).toHaveLength(12);
    const alice = await openClient(room, 'alice');
    const joined = await accepted(alice);
    await accepted(host);
    expect(joined.snapshot.room.commitment).toBeNull();
    expect(joined.snapshot.view.players.map(player => player.subject)).toEqual(['host', 'alice']);
    host.send({
      type: 'command',
      command: 'Start',
    });
    const started = await accepted(host);
    await accepted(alice);
    if (started.snapshot.room.commitment === null) throw new Error('game did not publish its commitment at start');
    expect(started.snapshot.room.commitmentConfig.patterns).toEqual([]);
    expect(started.snapshot.room.commitmentRoster.map(player => player.subject)).toEqual(['host', 'alice']);
    host.send({
      type: 'command',
      command: 'Close',
    });
    const finished = await accepted(host);
    await accepted(alice);
    const { revealedSeed } = finished.snapshot.view;
    if (revealedSeed === null) throw new Error('finished snapshot did not reveal its seed');
    if (finished.snapshot.room.commitment === null) throw new Error('finished game lost its commitment');
    const recomputed = engine.createCommitment({
      seed: revealedSeed,
      config: finished.snapshot.room.commitmentConfig,
      roster: finished.snapshot.room.commitmentRoster,
      roomId: finished.snapshot.room.roomId,
      gameIndex: finished.snapshot.room.gameIndex,
    });
    expect(recomputed.ok && recomputed.value.commitment).toBe(finished.snapshot.room.commitment);
  });
  it('keeps an unstarted game uncommitted and refuses its log after a lobby close', async () => {
    const room = roomName('unstarted-log');
    const host = await openClient(room);
    const lobby = await nextSnapshot(host);
    expect(lobby.room.commitment).toBeNull();
    expect(lobby.room.commitmentConfig).toBeNull();
    expect(lobby.room.commitmentRoster).toBeNull();
    host.send({
      type: 'command',
      command: 'Close',
    });
    const closed = await accepted(host);
    expect(closed.snapshot.room.commitment).toBeNull();
    expect(closed.snapshot.room.commitmentConfig).toBeNull();
    expect(closed.snapshot.room.commitmentRoster).toBeNull();
    const response = await fetchGameLog(room, 0);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'GameNotStarted',
    });
  });
  it('lets a kicked player fetch the log of the game they played', async () => {
    const room = roomName('kicked-log');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    const closed = new Promise<void>(resolve => {
      alice.socket.addEventListener('close', () => resolve(), {
        once: true,
      });
    });
    host.send({
      type: 'command',
      command: {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'alice',
          },
        },
      },
    });
    await accepted(host);
    await closed;
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    // Entitlement comes from the game being verified, so the removed player can still audit the game they played.
    const response = await fetchGameLog(room, 0, 'alice');
    expect(response.status).toBe(200);
    const log: GameLogResponse = await response.json();
    expect(log.host.subject).toBe('host');
    expect(log.log.length).toBeGreaterThan(0);
  });

  it('publishes a finished log with the initializing host and enough data to replay it', async () => {
    const room = roomName('game-log');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: {
        TransferHost: {
          target: {
            issuer: 'hmac',
            subject: 'alice',
          },
        },
      },
    });
    await accepted(host);
    await accepted(alice);
    alice.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    const running = await fetchGameLog(room, 0, 'alice');
    expect(running.status).toBe(409);
    expect(await running.json()).toEqual({
      error: 'GameNotFinished',
    });
    alice.send({
      type: 'command',
      command: 'Draw',
    });
    await accepted(host);
    await accepted(alice);
    alice.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    const finished = await accepted(alice);
    const missing = await fetchGameLog(room, 99, 'alice');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: 'GameNotFound',
    });
    const outsider = await fetchGameLog(room, 0, 'outsider');
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual({
      error: 'NotMember',
    });
    const response = await fetchGameLog(room, 0, 'alice');
    expect(response.status).toBe(200);
    const log: GameLogResponse = await response.json();
    expect(log.gameIndex).toBe(finished.snapshot.room.gameIndex);
    expect(log.host.subject).toBe('host');
    expect(log.log.map(engine.eventSequence)).toEqual(log.log.map((_event, index) => index));
    const { revealedSeed } = finished.snapshot.view;
    if (revealedSeed === null) throw new Error('finished snapshot did not reveal its seed');
    if (finished.snapshot.room.commitment === null) throw new Error('finished game did not publish its commitment');
    const replayed = engine.rebuild({
      config: finished.snapshot.room.commitmentConfig,
      seed: revealedSeed,
      host: log.host,
      log: log.log,
    });
    if (!replayed.ok) throw new Error(JSON.stringify(replayed.error));
    const projected = engine.projectHost(replayed.value.state);
    expect(projected.ok && projected.value).toEqual(finished.snapshot.view);
    const invalid = await workerExports.default.fetch(`https://example.test/rooms/${room}/games/-1/log`, {
      headers: {
        Authorization: await auth(room, 'alice'),
      },
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'InvalidGameIndex',
    });
  });
  it('projects exactly once per connected socket during a broadcast', async () => {
    const room = roomName('projection-count');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    const bob = await openClient(room, 'bob');
    await accepted(bob);
    await accepted(host);
    await accepted(alice);
    const hostProjection = vi.spyOn(engine, 'projectHost');
    const playerProjection = vi.spyOn(engine, 'projectPlayer');
    hostProjection.mockClear();
    playerProjection.mockClear();
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    await accepted(bob);
    expect(hostProjection.mock.calls.length + playerProjection.mock.calls.length).toBe(3);
    hostProjection.mockRestore();
    playerProjection.mockRestore();
  });
  it('supports latest-only history and undo without leaking older draws', async () => {
    const room = roomName('latest');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'settings',
      settings: {
        maxPlayers: 10,
        drawnVisibility: 'LatestOnly',
        hostAutoClose: true,
        rosterPersistence: 'KeepAcrossGames',
      },
    });
    const empty = await accepted(host);
    expect(empty.snapshot.view.drawn).toEqual([]);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Draw',
    });
    const first = await accepted(host);
    host.send({
      type: 'command',
      command: 'Draw',
    });
    const second = await accepted(host);
    expect(second.snapshot.view.drawn).toEqual(second.snapshot.drawnOrder);
    expect(second.snapshot.drawnOrder).toHaveLength(1);
    expect(second.snapshot.drawnOrder).not.toEqual(first.snapshot.drawnOrder);
    expect(first.events.events.some(event => 'NumberDrawn' in event || 'DrawUndone' in event)).toBe(false);
    expect(second.events.events.some(event => 'NumberDrawn' in event || 'DrawUndone' in event)).toBe(false);
    host.send({
      type: 'command',
      command: 'Undo',
    });
    const undone = await accepted(host);
    expect(undone.snapshot.drawnOrder).toEqual(first.snapshot.drawnOrder);
    expect(undone.events.events.some(event => 'NumberDrawn' in event || 'DrawUndone' in event)).toBe(false);
  });
  it('rejects malformed outer messages and structurally invalid domain payloads', async () => {
    const room = roomName('malformed');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'settings',
      settings: {
        maxPlayers: MAX_PLAYERS,
      },
    });
    const boundary = await accepted(host);
    expect(boundary.snapshot.room.settings.maxPlayers).toBe(MAX_PLAYERS);
    const malformed: (string | ArrayBuffer)[] = [
      new Uint8Array([1]).buffer,
      '{',
      'null',
      '{}',
      JSON.stringify({
        type: 'unknown',
      }),
      JSON.stringify({
        type: 'command',
      }),
      JSON.stringify({
        type: 'newGame',
      }),
      JSON.stringify({
        type: 'settings',
      }),
      JSON.stringify({
        type: 'settings',
        settings: null,
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          unknown: true,
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          maxPlayers: 'many',
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          maxPlayers: 1.5,
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          maxPlayers: 0,
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          maxPlayers: MAX_PLAYERS + 1,
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          drawnVisibility: 'Some',
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          hostAutoClose: 'yes',
        },
      }),
      JSON.stringify({
        type: 'settings',
        settings: {
          rosterPersistence: 'Forever',
        },
      }),
    ];
    for (const value of malformed) {
      host.socket.send(value);
      const awaitedResult8 = await errorMessage(host);
      expect(awaitedResult8.code).toBe('MalformedMessage');
    }
    for (const value of [
      {
        type: 'command',
        command: {
          hostile: true,
        },
      },
      {
        type: 'newGame',
        config: {
          ...OPEN_CONFIG,
          size: 'large',
        },
      },
    ]) {
      host.send(value);
      const input = await errorMessage(host);
      expect(input).toEqual({
        type: 'error',
        code: 'InvalidInput',
        detail: null,
      });
    }
  });
  it('returns config and state bridge errors', async () => {
    const invalidRoom = roomName('invalid-config');
    const invalidHost = await openClient(invalidRoom);
    await nextSnapshot(invalidHost);
    invalidHost.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(invalidHost);
    const beforeInvalidConfig = await storedSnapshot(invalidRoom);
    invalidHost.send({
      type: 'newGame',
      config: {
        ...OPEN_CONFIG,
        cardsPerPlayer: 0,
      },
    });
    const awaitedResult9 = await errorMessage(invalidHost);
    expect(awaitedResult9.code).toBe('NoCards');
    expect(await storedSnapshot(invalidRoom)).toBe(beforeInvalidConfig);
    const awaitedResult10 = await nextSnapshotAfterResync(invalidHost);
    expect(awaitedResult10.view.phase).toBe('Running');
    const corruptRoom = roomName('invalid-state');
    const corruptHost = await openClient(corruptRoom);
    await nextSnapshot(corruptHost);
    const stub = workerEnv.ROOM.getByName(corruptRoom);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE snapshot SET blob = ?', 'not a snapshot');
    });
    corruptHost.send({
      type: 'command',
      command: 'Start',
    });
    const stateError = await errorMessage(corruptHost);
    expect(stateError.code).toBe('InvalidState');
    expect(stateError.detail).toContain('snapshot is not valid');
  });
  it('enforces wrapper authorization, capacity, and locked-room joins', async () => {
    const room = roomName('wrapper-guards');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Join',
    });
    const awaitedResult11 = await errorMessage(host);
    expect(awaitedResult11.code).toBe('AlreadyJoined');
    alice.send({
      type: 'settings',
      settings: {
        maxPlayers: 1,
      },
    });
    const awaitedResult12 = await errorMessage(alice);
    expect(awaitedResult12.code).toBe('NotHost');
    alice.send({
      type: 'newGame',
      config: null,
    });
    const awaitedResult13 = await errorMessage(alice);
    expect(awaitedResult13.code).toBe('NotHost');
    host.send({
      type: 'settings',
      settings: {
        maxPlayers: 2,
      },
    });
    await accepted(host);
    await accepted(alice);
    const full = await workerExports.default.fetch(`https://example.test/rooms/${room}/ws`, {
      headers: {
        Upgrade: 'websocket',
        Authorization: await auth(room, 'bob'),
      },
    });
    expect(full.status).toBe(409);
    const lockedRoom = roomName('locked');
    const lockedHost = await openClient(lockedRoom);
    await nextSnapshot(lockedHost);
    lockedHost.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(lockedHost);
    const locked = await workerExports.default.fetch(`https://example.test/rooms/${lockedRoom}/ws`, {
      headers: {
        Upgrade: 'websocket',
        Authorization: await auth(lockedRoom, 'alice'),
      },
    });
    expect(locked.status).toBe(409);
  });
  it('does not commit a join when the socket attachment fails and allows a clean retry', async () => {
    const room = roomName('attachment-order');
    const host = await openClient(room);
    await nextSnapshot(host);
    const player: PlayerIdDto = {
      issuer: 'hmac',
      subject: 'alice',
    };
    const request = internalRequest(room, player, true);
    const oversizedDisplayName = `${'a'.repeat(8200)}日`;
    request.headers.set(
      VERIFIED_IDENTITY_HEADER,
      encodeIdentity({
        player,
        displayName: oversizedDisplayName,
      }).replace('日', String.raw`\u65e5`),
    );
    await expect(workerEnv.ROOM.getByName(room).fetch(request)).rejects.toThrow();
    expect(await rosterCount(room)).toBe(1);
    const afterFailure = await nextSnapshotAfterResync(host);
    expect(afterFailure.view.players.map(participant => participant.subject)).toEqual(['host']);
    const alice = await openClient(room, 'alice');
    const retried = await accepted(alice);
    await accepted(host);
    expect(retried.snapshot.view.players.map(participant => participant.subject)).toEqual(['host', 'alice']);
  });
  it('restores a departed roster member even when new joins are locked', async () => {
    const room = roomName('returning');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    alice.send({
      type: 'command',
      command: 'Leave',
    });
    await accepted(alice);
    await accepted(host);
    await alice.close();
    await scheduler.wait(10);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    const returning = await openClient(room, 'alice');
    const joined = await accepted(returning);
    await accepted(host);
    expect(joined.snapshot.view.cards).toHaveLength(1);
  });
  it('revokes kicked sockets and preserves the tombstone until the next game', async () => {
    const room = roomName('kick-revocation');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'newGame',
      config: null,
    });
    await replacementAccepted(host);
    await replacementAccepted(alice);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    const closed = new Promise<void>(resolve => {
      alice.socket.addEventListener('close', () => resolve(), {
        once: true,
      });
    });
    host.send({
      type: 'command',
      command: {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'alice',
          },
        },
      },
    });
    await accepted(host);
    await closed;
    expect(alice.socket.readyState).toBe(WebSocket.CLOSED);
    expect(alice.frames).toEqual([]);
    host.send({
      type: 'settings',
      settings: {
        hostAutoClose: true,
      },
    });
    await accepted(host);
    expect(alice.frames).toEqual([]);
    const rejected = await workerExports.default.fetch(`https://example.test/rooms/${room}/ws`, {
      headers: {
        Upgrade: 'websocket',
        Authorization: await auth(room, 'alice'),
      },
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      error: 'JoinRejected',
    });
    await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => {
      const fresh = new Room(state, workerEnv);
      const response = fresh.fetch(
        internalRequest(
          room,
          {
            issuer: 'hmac',
            subject: 'alice',
          },
          true,
        ),
      );
      expect(response.status).toBe(409);
    });
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    const entitled = await fetchGameLog(room, 1, 'alice');
    expect(entitled.status).toBe(200);
    host.send({
      type: 'newGame',
      config: null,
    });
    await accepted(host);
    const returned = await openClient(room, 'alice');
    await accepted(returned);
    await accepted(host);
  });
  it('clears non-host roster entries between games when configured', async () => {
    const room = roomName('clear-roster');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'settings',
      settings: {
        maxPlayers: 1,
        rosterPersistence: 'ClearBetweenGames',
      },
    });
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'newGame',
      config: null,
    });
    await replacementAccepted(host);
    await replacementAccepted(alice);
    expect(await rosterCount(room)).toBe(1);
    alice.send({
      type: 'command',
      command: 'Join',
    });
    const awaitedResult14 = await errorMessage(alice);
    expect(awaitedResult14.code).toBe('JoinRejected');
    host.send({
      type: 'settings',
      settings: {
        maxPlayers: 2,
      },
    });
    await accepted(host);
    await accepted(alice);
    alice.send({
      type: 'command',
      command: 'Join',
    });
    await accepted(alice);
    await accepted(host);
    expect(await rosterCount(room)).toBe(2);
  });
  it("keeps an earlier game's log available to its start roster after clearing current membership", async () => {
    const room = roomName('cleared-log-entitlement');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'newGame',
      config: null,
    });
    await replacementAccepted(host);
    await replacementAccepted(alice);
    host.send({
      type: 'settings',
      settings: {
        rosterPersistence: 'ClearBetweenGames',
      },
    });
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    await accepted(alice);
    host.send({
      type: 'newGame',
      config: null,
    });
    await accepted(host);
    await accepted(alice);
    expect(await rosterCount(room)).toBe(1);
    const response = await fetchGameLog(room, 1, 'alice');
    expect(response.status).toBe(200);
  });
  it('keeps the verified host display name when clearing the roster', async () => {
    const room = roomName('host-name');
    const host = await openClient(room, 'host', {}, 'Verified Host');
    await nextSnapshot(host);
    host.send({
      type: 'settings',
      settings: {
        rosterPersistence: 'ClearBetweenGames',
      },
    });
    await accepted(host);
    host.send({
      type: 'newGame',
      config: null,
    });
    await replacementAccepted(host);
    expect(await rosterDisplayName(room, 'host')).toBe('Verified Host');
  });
  it('re-arms and clears the seed-reveal deadline for each game', async () => {
    const room = roomName('reveal-deadline');
    const host = await openClient(room);
    await nextSnapshot(host);
    await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => {
      state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', 1, 'reveal_backstop');
    });
    host.send({
      type: 'newGame',
      config: null,
    });
    await replacementAccepted(host);
    expect(await deadlineAt(room, 'reveal_backstop')).toBeGreaterThan(Date.now());
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    expect(await deadlineAt(room, 'reveal_backstop')).toBeNull();
  });
  it('updates cached status after an automatic win', async () => {
    const room = roomName('automatic-finish');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'newGame',
      config: {
        ...OPEN_CONFIG,
        freeCenter: false,
        patterns: [[0]],
        winLimit: 'FirstOnly',
      },
    });
    await replacementAccepted(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    let revealed: string | null = null;
    for (let draw = 0; draw < 75 && revealed === null; draw += 1) {
      host.send({
        type: 'command',
        command: 'Draw',
      });
      const awaitedResult15 = await accepted(host);
      revealed = awaitedResult15.snapshot.view.revealedSeed;
    }
    expect(revealed).toBe(await storedSeed(room));
  });
});
describe('host departure and alarms', () => {
  it('transfers immediately when the host leaves or kicks itself', async () => {
    for (const command of [
      'Leave',
      {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'host',
          },
        },
      },
    ]) {
      const room = roomName('depart');
      const host = await openClient(room);
      await nextSnapshot(host);
      const alice = await openClient(room, 'alice');
      await accepted(alice);
      await accepted(host);
      host.send({
        type: 'command',
        command,
      });
      const result = command === 'Leave' ? await accepted(host) : await accepted(alice);
      if (command === 'Leave') await accepted(alice);
      expect(result.snapshot.room.host.subject).toBe('alice');
      expect(result.events.events.some(event => 'HostTransferred' in event)).toBe(true);
    }
  });
  it('transfers an absent host when its deadline expires', async () => {
    const room = roomName('host-alarm');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    await host.close();
    await scheduler.wait(10);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', 1, 'host_absent');
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    alice.send({
      type: 'resync',
    });
    const result = await nextSnapshot(alice);
    expect(result.room.host.subject).toBe('alice');
  });
  it("does not postpone an absent host's deadline when another player reconnects", async () => {
    const room = roomName('stable-host-deadline');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    await host.close();
    await scheduler.wait(10);
    const armed = await deadlineAt(room, 'host_absent');
    expect(armed).not.toBeNull();
    await alice.close();
    await scheduler.wait(10);
    const reconnected = await openClient(room, 'alice');
    await nextSnapshot(reconnected);
    expect(await deadlineAt(room, 'host_absent')).toBe(armed);
    const returnedHost = await openClient(room);
    await nextSnapshot(returnedHost);
    expect(await deadlineAt(room, 'host_absent')).toBeNull();
  });
  it('closes instead of transferring when an auto-closing host departs', async () => {
    for (const command of [
      'Leave',
      {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'host',
          },
        },
      },
    ]) {
      const room = roomName('auto-close-command');
      const host = await openClient(room);
      await nextSnapshot(host);
      const alice = await openClient(room, 'alice');
      await accepted(alice);
      await accepted(host);
      host.send({
        type: 'settings',
        settings: {
          hostAutoClose: true,
        },
      });
      await accepted(host);
      await accepted(alice);
      host.send({
        type: 'command',
        command,
      });
      const result = command === 'Leave' ? await accepted(host) : await accepted(alice);
      if (command === 'Leave') await accepted(alice);
      expect(result.snapshot.view.phase).toBe('Finished');
      expect(result.snapshot.view.revealedSeed).toBe(await storedSeed(room));
      expect(result.snapshot.room.host.subject).toBe('host');
      expect(result.events.events.some(event => 'GameClosed' in event)).toBe(true);
      expect(result.events.events.some(event => 'HostTransferred' in event)).toBe(false);
    }
  });
  it('closes when an auto-closing host absence expires', async () => {
    const room = roomName('auto-close-absence');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'settings',
      settings: {
        hostAutoClose: true,
      },
    });
    await accepted(host);
    await accepted(alice);
    await host.close();
    await scheduler.wait(10);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', 1, 'host_absent');
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const result = await accepted(alice);
    expect(result.snapshot.view.phase).toBe('Finished');
    expect(result.snapshot.room.host.subject).toBe('host');
  });
  it('closes an empty room and reveals its seed', async () => {
    const room = roomName('empty-alarm');
    const host = await openClient(room);
    await nextSnapshot(host);
    await host.close();
    await scheduler.wait(10);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', 1, 'room_empty');
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const response = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        Authorization: await auth(room),
      },
    });
    const message: ServerMessage = await response.json();
    expect(message.type === 'snapshot' && message.view.revealedSeed).toBe(await storedSeed(room));
  });
  it('reassigns wrapper ownership after a finished host disconnects', async () => {
    const room = roomName('finished-host');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    await accepted(alice);
    await host.close();
    await scheduler.wait(10);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', 1, 'host_absent');
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const transferred = await accepted(alice);
    expect(transferred.snapshot.room.host.subject).toBe('alice');
    expect(transferred.events.events).toEqual([]);
    alice.send({
      type: 'newGame',
      config: null,
    });
    const awaitedResult16 = await accepted(alice);
    expect(awaitedResult16.snapshot.room.gameIndex).toBe(1);
  });
});
describe('additional room edges', () => {
  it('arms the empty-room deadline when a lone host departs', async () => {
    const room = roomName('lone-departure');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Leave',
    });
    const result = await accepted(host);
    expect(result.snapshot.room.host.subject).toBe('host');
    const armed = await runInDurableObject(
      workerEnv.ROOM.getByName(room),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            count: number;
          }>('SELECT COUNT(*) AS count FROM deadlines WHERE kind = ?', 'room_empty')
          .one().count,
    );
    expect(armed).toBe(1);
  });
  it('handles each terminal deadline and an empty schedule', async () => {
    const presentRoom = roomName('present-deadline');
    const presentHost = await openClient(presentRoom);
    await nextSnapshot(presentHost);
    await replaceDeadlines(presentRoom, [['room_empty', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(presentRoom))).toBe(true);
    const awaitedResult17 = await nextSnapshotAfterResync(presentHost);
    expect(awaitedResult17.view.revealedSeed).toBeNull();
    const revealRoom = roomName('backstop');
    const revealHost = await openClient(revealRoom);
    await nextSnapshot(revealHost);
    await replaceDeadlines(revealRoom, [['reveal_backstop', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(revealRoom))).toBe(true);
    const awaitedResult18 = await accepted(revealHost);
    expect(awaitedResult18.snapshot.view.revealedSeed).toBe(await storedSeed(revealRoom));
    await replaceDeadlines(revealRoom, [['reveal_backstop', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(revealRoom))).toBe(true);
    const unknownRoom = roomName('unknown-deadline');
    const unknownHost = await openClient(unknownRoom);
    await nextSnapshot(unknownHost);
    await replaceDeadlines(unknownRoom, [['unknown', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(unknownRoom))).toBe(true);
    const gcRoom = roomName('gc');
    const gcHost = await openClient(gcRoom);
    await nextSnapshot(gcHost);
    await replaceDeadlines(gcRoom, [['room_gc', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(gcRoom))).toBe(true);
    const awaitedResult19 = await workerEnv.ROOM.getByName(gcRoom).fetch(internalRequest(gcRoom));
    expect(awaitedResult19.status).toBe(200);
    await gcHost.close();
    await scheduler.wait(10);
    await replaceDeadlines(gcRoom, [['room_gc', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(gcRoom))).toBe(true);
    const awaitedResult20 = await workerEnv.ROOM.getByName(gcRoom).fetch(internalRequest(gcRoom));
    expect(awaitedResult20.status).toBe(404);
  });
  it('does not let state reads refresh garbage collection or expose rooms to outsiders', async () => {
    const room = roomName('gc-refresh');
    const host = await openClient(room);
    await nextSnapshot(host);
    await replaceDeadlines(room, [['room_gc', 1]]);
    const outsiderResponse = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        Authorization: await auth(room, 'outsider'),
      },
    });
    expect(outsiderResponse.status).toBe(403);
    expect(await outsiderResponse.json()).toEqual({
      error: 'NotMember',
    });
    expect(await deadlineAt(room, 'room_gc')).toBe(1);
    const stateResponse = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        Authorization: await auth(room),
      },
    });
    expect(stateResponse.status).toBe(200);
    expect(await deadlineAt(room, 'room_gc')).toBe(1);
    await replaceDeadlines(room, [['room_gc', 1]]);
    await nextSnapshotAfterResync(host);
    expect(await deadlineAt(room, 'room_gc')).toBeGreaterThan(Date.now());
    await host.close();
    await scheduler.wait(10);
    await replaceDeadlines(room, [['room_gc', 1]]);
    const reconnected = await openClient(room);
    await nextSnapshot(reconnected);
    expect(await deadlineAt(room, 'room_gc')).toBeGreaterThan(Date.now());
  });
  it('collects a room whose open sockets have no usable identity', async () => {
    const room = roomName('unidentified-gc');
    const host = await openClient(room);
    await nextSnapshot(host);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      const socket = state.getWebSockets().at(0);
      if (socket === undefined) throw new Error('host socket is missing');
      socket.serializeAttachment(null);
    });
    await replaceDeadlines(room, [['room_gc', 1]]);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const response = await stub.fetch(internalRequest(room));
    expect(response.status).toBe(404);
  });
  it('handles absence without a successor and a stale wrapper host', async () => {
    const emptyRoom = roomName('no-successor');
    const emptyHost = await openClient(emptyRoom);
    await nextSnapshot(emptyHost);
    await emptyHost.close();
    await scheduler.wait(10);
    await replaceDeadlines(emptyRoom, [['host_absent', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(emptyRoom))).toBe(true);
    const armed = await runInDurableObject(
      workerEnv.ROOM.getByName(emptyRoom),
      (_instance, state) =>
        state.storage.sql
          .exec<{
            count: number;
          }>('SELECT COUNT(*) AS count FROM deadlines WHERE kind = ?', 'room_empty')
          .one().count,
    );
    expect(armed).toBe(1);
    const invalidRoom = roomName('invalid-host');
    const invalidHost = await openClient(invalidRoom);
    await nextSnapshot(invalidHost);
    const alice = await openClient(invalidRoom, 'alice');
    await accepted(alice);
    await accepted(invalidHost);
    const invalidStub = workerEnv.ROOM.getByName(invalidRoom);
    await runInDurableObject(invalidStub, (_instance, state) => {
      state.storage.sql.exec(
        'UPDATE settings SET v = ? WHERE k = ?',
        JSON.stringify({
          issuer: 'hmac',
          subject: 'nobody',
        }),
        'host',
      );
    });
    await replaceDeadlines(invalidRoom, [['host_absent', 1]]);
    expect(await runDurableObjectAlarm(invalidStub)).toBe(true);
    const awaitedResult21 = await nextSnapshotAfterResync(alice);
    expect(awaitedResult21.room.host.subject).toBe('nobody');
  });
  it('keeps the socket alive if a departing-host transfer is rejected', async () => {
    for (const hostAutoClose of [false, true]) {
      const room = roomName('rejected-departure-transfer');
      const host = await openClient(room);
      await nextSnapshot(host);
      const alice = await openClient(room, 'alice');
      await accepted(alice);
      await accepted(host);
      await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => {
        state.storage.sql.exec(
          'UPDATE settings SET v = ? WHERE k = ?',
          JSON.stringify({
            issuer: 'hmac',
            subject: 'alice',
          }),
          'host',
        );
        if (hostAutoClose) {
          state.storage.sql.exec(
            'UPDATE settings SET v = ? WHERE k = ?',
            JSON.stringify({
              maxPlayers: 75,
              drawnVisibility: 'Full',
              hostAutoClose: true,
              rosterPersistence: 'KeepAcrossGames',
            }),
            'room_settings',
          );
        }
      });
      alice.send({
        type: 'command',
        command: 'Leave',
      });
      const result = await accepted(alice);
      await accepted(host);
      expect(result.snapshot.room.host.subject).toBe('alice');
      expect(alice.socket.readyState).toBe(WebSocket.OPEN);
    }
  });
  it('tolerates an abandonment close rejected by the engine', async () => {
    const room = roomName('unclearable-empty');
    const host = await openClient(room);
    await nextSnapshot(host);
    await host.close();
    await scheduler.wait(10);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        'UPDATE settings SET v = ? WHERE k = ?',
        JSON.stringify({
          issuer: 'hmac',
          subject: 'nobody',
        }),
        'host',
      );
    });
    await replaceDeadlines(room, [['room_empty', 1]]);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
  });
});
describe('direct object boundaries', () => {
  it('keeps the message callback synchronous', async () => {
    const room = roomName('synchronous-message');
    const host = await openClient(room);
    await nextSnapshot(host);
    await runInDurableObject(workerEnv.ROOM.getByName(room), (instance, state) => {
      const socket = state.getWebSockets().at(0);
      if (socket === undefined) throw new Error('host socket is missing');
      expect(
        instance.webSocketMessage(
          socket,
          JSON.stringify({
            type: 'resync',
          }),
        ),
      ).toBeUndefined();
    });
    await nextSnapshot(host);
  });
  it('rate-limits each socket in memory without closing it', async () => {
    const room = roomName('message-rate');
    const host = await openClient(room);
    await nextSnapshot(host);
    const startedAt = Date.now();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(startedAt);
      await runInDurableObject(workerEnv.ROOM.getByName(room), (instance, state) => {
        const socket = state.getWebSockets().at(0);
        if (socket === undefined) throw new Error('host socket is missing');
        for (let message = 0; message < DEADLINE_HORIZONS.messageRateLimit; message += 1) {
          instance.webSocketMessage(socket, '{');
        }
        instance.webSocketMessage(socket, '{');
        vi.setSystemTime(startedAt + DEADLINE_HORIZONS.messageRateWindow);
        instance.webSocketMessage(
          socket,
          JSON.stringify({
            type: 'resync',
          }),
        );
      });
    } finally {
      vi.useRealTimers();
    }
    for (let message = 0; message < DEADLINE_HORIZONS.messageRateLimit; message += 1) {
      const awaitedResult22 = await errorMessage(host);
      expect(awaitedResult22.code).toBe('MalformedMessage');
    }
    const awaitedResult23 = await errorMessage(host);
    expect(awaitedResult23.code).toBe('RateLimited');
    await nextSnapshot(host);
    expect(host.socket.readyState).toBe(WebSocket.OPEN);
  });
  it('keeps equal subjects from different issuers in separate roster rows', async () => {
    const room = roomName('issuer-scope');
    const host = await openClient(room);
    await nextSnapshot(host);
    const response = await workerEnv.ROOM.getByName(room).fetch(
      internalRequest(
        room,
        {
          issuer: 'second',
          subject: 'host',
        },
        true,
      ),
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (socket === null) throw new Error('direct socket is missing');
    socket.accept();
    expect(await rosterCount(room)).toBe(2);
    socket.close(1000, 'complete');
  });
  it('rejects missing metadata and reports absent rooms', async () => {
    const room = roomName('direct-errors');
    const stub = workerEnv.ROOM.getByName(room);
    const awaitedResult24 = await stub.fetch(new Request('https://room.internal/'));
    expect(awaitedResult24.status).toBe(401);
    const awaitedResult25 = await stub.fetch(
      new Request('https://room.internal/', {
        headers: {
          [VERIFIED_IDENTITY_HEADER]: '{',
        },
      }),
    );
    expect(awaitedResult25.status).toBe(401);
    const missingRoom = internalRequest(room);
    missingRoom.headers.delete(ROOM_KEY_HEADER);
    const awaitedResult26 = await stub.fetch(missingRoom);
    expect(awaitedResult26.status).toBe(400);
    const invalidMode = internalRequest(room);
    invalidMode.headers.set(ROOM_MODE_HEADER, 'invalid');
    const awaitedResult27 = await stub.fetch(invalidMode);
    expect(await awaitedResult27.json()).toEqual({
      error: 'InvalidMode',
    });
    const awaitedResult28 = await stub.fetch(internalRequest(room));
    expect(awaitedResult28.status).toBe(404);
  });
  it('handles invalid attachments, skipped recipients, and error callbacks', async () => {
    const room = roomName('attachments');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (instance, state) => {
      const aliceSocket = state.getWebSockets().find(socket => {
        const attachment: unknown = socket.deserializeAttachment();
        return (
          typeof attachment === 'object' &&
          attachment !== null &&
          'player' in attachment &&
          typeof attachment.player === 'object' &&
          attachment.player !== null &&
          'subject' in attachment.player &&
          attachment.player.subject === 'alice'
        );
      });
      if (aliceSocket === undefined) throw new Error('alice socket is missing');
      aliceSocket.serializeAttachment(null);
      instance.webSocketMessage(
        aliceSocket,
        JSON.stringify({
          type: 'resync',
        }),
      );
    });
    const awaitedResult29 = await errorMessage(alice);
    expect(awaitedResult29.code).toBe('MissingIdentity');
    await runInDurableObject(stub, (instance, state) => {
      const sockets = state.getWebSockets();
      const aliceSocket = sockets.find(socket => socket.deserializeAttachment() === null);
      if (aliceSocket === undefined) {
        throw new Error('invalid socket is missing');
      }
      aliceSocket.serializeAttachment({
        issuer: 1,
        subject: 'alice',
      });
      instance.webSocketMessage(
        aliceSocket,
        JSON.stringify({
          type: 'resync',
        }),
      );
      aliceSocket.serializeAttachment({
        issuer: 'hmac',
        subject: 1,
      });
      instance.webSocketMessage(
        aliceSocket,
        JSON.stringify({
          type: 'resync',
        }),
      );
      aliceSocket.serializeAttachment(null);
      const hostSocket = sockets.find(socket => socket !== aliceSocket);
      if (hostSocket === undefined) throw new Error('host socket is missing');
      instance.webSocketMessage(
        hostSocket,
        JSON.stringify({
          type: 'command',
          command: 'Start',
        }),
      );
      aliceSocket.serializeAttachment({
        player: {
          issuer: 'hmac',
          subject: 'alice',
        },
        displayName: 'Alice',
      });
      instance.webSocketError(aliceSocket);
    });
    const awaitedResult30 = await errorMessage(alice);
    expect(awaitedResult30.code).toBe('MissingIdentity');
    const awaitedResult31 = await errorMessage(alice);
    expect(awaitedResult31.code).toBe('MissingIdentity');
    await accepted(host);
  });
  it('surfaces missing durable rows', async () => {
    const settingRoom = roomName('missing-setting');
    const first = await openClient(settingRoom);
    await nextSnapshot(first);
    await runInDurableObject(workerEnv.ROOM.getByName(settingRoom), (instance, state) => {
      state.storage.sql.exec('DELETE FROM settings WHERE k = ?', 'host');
      expect(() => instance.fetch(internalRequest(settingRoom))).toThrow('missing setting');
    });
    const gameRoom = roomName('missing-game');
    const second = await openClient(gameRoom);
    await nextSnapshot(second);
    await runInDurableObject(workerEnv.ROOM.getByName(gameRoom), (instance, state) => {
      state.storage.sql.exec('DELETE FROM games');
      expect(() => instance.fetch(internalRequest(gameRoom))).toThrow('current game is missing');
    });
  });
  it('returns a close error when stored status disagrees with engine state', async () => {
    const room = roomName('stale-status');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => {
      state.storage.sql.exec('UPDATE games SET phase = ?', 'Running');
    });
    host.send({
      type: 'newGame',
      config: null,
    });
    const awaitedResult32 = await errorMessage(host);
    expect(awaitedResult32.code).toBe('WrongPhase');
  });
  it('starts a new game directly from a normally finished game', async () => {
    const room = roomName('finished-new-game');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Close',
    });
    await accepted(host);
    host.send({
      type: 'newGame',
      config: null,
    });
    const awaitedResult33 = await accepted(host);
    expect(awaitedResult33.snapshot.room.gameIndex).toBe(1);
  });
  it('fails loudly when replay cannot rebuild a corrupt event row', async () => {
    const room = roomName('corrupt-replay');
    const host = await openClient(room);
    await nextSnapshot(host);
    await runInDurableObject(workerEnv.ROOM.getByName(room), (instance, state) => {
      state.storage.sql.exec('DELETE FROM snapshot');
      state.storage.sql.exec('UPDATE events SET payload = ?', 'null');
      expect(() => instance.fetch(internalRequest(room))).toThrow();
    });
  });
});
describe('engine event helpers', () => {
  it('returns projection errors for invalid opaque snapshots', () => {
    const player: PlayerIdDto = {
      issuer: 'hmac',
      subject: 'alice',
    };
    expect(engine.projectPlayer('invalid', player).ok).toBe(false);
    expect(engine.projectHost('invalid').ok).toBe(false);
  });
  it('extracts every generated event sequence and kind', () => {
    const player: PlayerIdDto = {
      issuer: 'hmac',
      subject: 'alice',
    };
    const events: EventDto[] = [
      {
        PlayerJoined: {
          seq: 0,
          player,
        },
      },
      {
        PlayerLeft: {
          seq: 1,
          player,
        },
      },
      {
        MarkPlaced: {
          seq: 2,
          player,
          cardIx: 0,
          row: 0,
          col: 0,
        },
      },
      {
        MarkRemoved: {
          seq: 3,
          player,
          cardIx: 0,
          row: 0,
          col: 0,
        },
      },
      {
        BingoClaimed: {
          seq: 4,
          player,
          cardIx: 0,
        },
      },
      {
        GameStarted: {
          seq: 5,
          actor: player,
        },
      },
      {
        NumberDrawn: {
          seq: 6,
          actor: player,
          number: 1,
        },
      },
      {
        DrawUndone: {
          seq: 7,
          actor: player,
          number: 1,
          revoked: [],
        },
      },
      {
        PlayerKicked: {
          seq: 8,
          actor: player,
          target: player,
        },
      },
      {
        HostTransferred: {
          seq: 9,
          actor: player,
          target: player,
        },
      },
      {
        GameClosed: {
          seq: 10,
          actor: player,
        },
      },
      {
        WinRecognized: {
          seq: 11,
          winners: [player],
          patterns: [[0]],
          atSeq: 10,
          rank: 1,
        },
      },
    ];
    expect(events.map(event => engine.eventSequence(event))).toEqual(events.map((_event, index) => index));
    expect(events.map(event => engine.eventKind(event))).toEqual([
      'PlayerJoined',
      'PlayerLeft',
      'MarkPlaced',
      'MarkRemoved',
      'BingoClaimed',
      'GameStarted',
      'NumberDrawn',
      'DrawUndone',
      'PlayerKicked',
      'HostTransferred',
      'GameClosed',
      'WinRecognized',
    ]);
  });
});
