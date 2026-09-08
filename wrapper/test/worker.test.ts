import type { GameLogResponse, ServerMessage } from '../src/protocol';
import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';

import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env as workerEnv, exports as workerExports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';

import * as engine from '../src/engine';
import { ROOM_KEY_HEADER, ROOM_MODE_HEADER, VERIFIED_IDENTITY_HEADER, decodeIdentity, encodeIdentity } from '../src/identity';
import { Room } from '../src/room';
import { DEADLINE_HORIZONS, MAX_PLAYERS } from '../src/settings';

let roomCounter = 0;
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
const identityHeader = (subject = 'host', issuer = 'hmac', displayName = subject): string =>
  encodeIdentity({
    player: {
      issuer,
      subject,
    },
    displayName,
  });
const openClient = async (room: string, subject = 'host', extraHeaders: HeadersInit = {}, displayName = subject, issuer = 'hmac'): Promise<TestClient> => {
  const headers = new Headers(extraHeaders);
  headers.set('Upgrade', 'websocket');
  headers.set(VERIFIED_IDENTITY_HEADER, identityHeader(subject, issuer, displayName));
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
      [VERIFIED_IDENTITY_HEADER]: identityHeader(subject),
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
/** How many rows a table is holding, which is how a room's storage is asked whether it is still carrying games it has finished with. */
const rowCount = async (room: string, table: string): Promise<number> => {
  const stub = workerEnv.ROOM.getByName(room);
  return runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec<{
        count: number;
      }>(`SELECT COUNT(*) AS count FROM ${table}`)
      .toArray()
      .at(0);
    return row?.count ?? -1;
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
const winPatternsFor = (events: EventDto[], subject: string): number[][] =>
  events.flatMap(event =>
    'WinRecognized' in event && event.WinRecognized.winners.some(player => player.subject === subject) ? event.WinRecognized.patterns : [],
  );
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
/** A room whose roster is already full at its host, so the next connection can only watch it. */
const openWatchedRoom = async (label: string): Promise<{ room: string; host: TestClient; watcher: TestClient }> => {
  const room = roomName(label);
  const host = await openClient(room);
  await nextSnapshot(host);
  host.send({
    type: 'settings',
    settings: {
      maxPlayers: 1,
    },
  });
  await accepted(host);
  const watcher = await openClient(room, 'watcher');
  await nextSnapshot(watcher);
  return {
    room,
    host,
    watcher,
  };
};
/** The same room with a seated player who is not the host, which is the view a watcher's is compared against. */
const openWatchedGame = async (label: string): Promise<{ room: string; host: TestClient; alice: TestClient; watcher: TestClient }> => {
  const room = roomName(label);
  const host = await openClient(room);
  await nextSnapshot(host);
  const alice = await openClient(room, 'alice');
  await accepted(alice);
  await accepted(host);
  host.send({
    type: 'settings',
    settings: {
      maxPlayers: 2,
    },
  });
  await accepted(host);
  await accepted(alice);
  const watcher = await openClient(room, 'watcher');
  await nextSnapshot(watcher);
  return {
    room,
    host,
    alice,
    watcher,
  };
};
/** Draws until one of `cells` has been called, returning everything drawn by then and draining the frames every other client was sent. */
const drawUntilCardHit = async (host: TestClient, others: TestClient[], cells: number[]): Promise<number[]> => {
  for (let draw = 0; draw < 75; draw += 1) {
    host.send({
      type: 'command',
      command: 'Draw',
    });
    const result = await accepted(host);
    for (const other of others) {
      await accepted(other);
    }
    const { drawn } = result.snapshot.view;
    if (drawn.some(number => cells.includes(number))) return drawn;
  }
  throw new Error('no draw landed on the card');
};
/** The host the game itself is being played under, which the room's own host outlives. */
const gameHostSubject = async (room: string): Promise<string> => {
  const projected = engine.projectHost(await storedSnapshot(room));
  if (!projected.ok) throw new Error('the stored snapshot does not project');
  return projected.value.host.subject;
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
        [VERIFIED_IDENTITY_HEADER]: identityHeader(),
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
  it('accepts a forwarded websocket protocol', async () => {
    const room = roomName('browser');
    const protocol = 'bingo.v1';
    const response = await workerExports.default.fetch(`https://example.test/rooms/${room}/ws`, {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: identityHeader('browser'),
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': protocol,
      },
    });
    expect(response.status).toBe(101);
    expect(response.headers.get('Sec-WebSocket-Protocol')).toBe(protocol);
    const socket = response.webSocket;
    if (socket === null) throw new Error('browser socket is missing');
    socket.accept();
    socket.close(1000, 'complete');
  });
  it('rejects decoded room ids that are unsafe for internal headers', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/bad%0Aroom/state', {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: identityHeader(),
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'InvalidRoomId',
    });
  });
  it('rejects a missing identity header', async () => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        Upgrade: 'websocket',
      },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'MissingIdentity',
    });
  });
  it.each([
    ['malformed', JSON.stringify({ player: { issuer: 'test', subject: 'host' } })],
    ['unparseable', '{'],
  ])('rejects an %s identity header', async (_label, encodedIdentity) => {
    const response = await workerExports.default.fetch('https://example.test/rooms/auth/ws', {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: encodedIdentity,
        Upgrade: 'websocket',
      },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'InvalidIdentity',
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
      {
        player: {
          issuer: 'hmac',
          subject: '',
        },
        displayName: 'name',
      },
      {
        player: {
          issuer: 'hmac',
          subject: 'subject',
        },
        displayName: '',
      },
      {
        player: {
          issuer: 'hmac',
          subject: 'a'.repeat(257),
        },
        displayName: 'name',
      },
      {
        player: {
          issuer: 'hmac',
          subject: 'subject',
        },
        displayName: 'a'.repeat(257),
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
    // The event carries the same board position the projection blanks, so both deliveries have to withhold it from everyone but the winner.
    expect(winPatternsFor(winningHost.events.events, 'alice')).toEqual([]);
    expect(winPatternsFor(winningAlice.events.events, 'alice')).toEqual([[0]]);
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

  it('keeps every finished game the room can be asked about, and none of the state rebuilt from it', async () => {
    const room = roomName('derived-state-pruned');
    const host = await openClient(room);
    await nextSnapshot(host);
    for (let game = 0; game < 3; game += 1) {
      host.send({
        type: 'newGame',
        config: OPEN_CONFIG,
      });
      await replacementAccepted(host);
    }
    // Four games dealt: the first and three replacements. Their logs, configs and seeds are the evidence a player checks the deal against.
    expect(await rowCount(room, 'games')).toBe(4);
    // The engine state and the running totals are read only for the game being played, and both rebuild from the log on a miss.
    expect(await rowCount(room, 'snapshot')).toBe(1);
    expect(await rowCount(room, 'game_cache')).toBe(1);
    await host.close();
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
        [VERIFIED_IDENTITY_HEADER]: identityHeader('alice'),
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
  it('enforces wrapper authorization, and lets a connection the game cannot seat watch it instead', async () => {
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
    // The roster is full, so the third connection is seated by nobody and joins no roster; it is still given the room to look at.
    const bob = await openClient(room, 'bob');
    const watching = await nextSnapshot(bob);
    expect(watching.view.players.map(player => player.subject)).toStrictEqual(['host', 'alice']);
    const lockedRoom = roomName('locked');
    const lockedHost = await openClient(lockedRoom);
    await nextSnapshot(lockedHost);
    lockedHost.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(lockedHost);
    const latecomer = await openClient(lockedRoom, 'alice');
    const locked = await nextSnapshot(latecomer);
    expect(locked.view.phase).toBe('Running');
    expect(locked.view.players.map(player => player.subject)).toStrictEqual(['host']);
    // Watching a bingo game is watching the cards, so the projection is the one the host is given rather than an empty hand.
    expect(locked.view.cards.map(card => card.owner.subject)).toStrictEqual(['host']);
    latecomer.send({
      type: 'command',
      command: 'Join',
    });
    const refused = await errorMessage(latecomer);
    expect(refused.code).toBe('RoomLocked');
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
        [VERIFIED_IDENTITY_HEADER]: identityHeader('alice'),
        Upgrade: 'websocket',
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
  it('keeps playing after a recognised win under the default configuration', async () => {
    const room = roomName('default-win-limit');
    const host = await openClient(room);
    const opening = await nextSnapshot(host);
    // A room does not know what it is being played for, so nobody winning is what ends it.
    expect(opening.view.config.winLimit).toBe('Unlimited');
    host.send({
      type: 'newGame',
      config: {
        ...opening.view.config,
        freeCenter: false,
        patterns: [[0]],
      },
    });
    const replaced = await replacementAccepted(host);
    expect(replaced.snapshot.view.config.winLimit).toBe('Unlimited');
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    let wins = 0;
    for (let draw = 0; draw < 75 && wins === 0; draw += 1) {
      host.send({
        type: 'command',
        command: 'Draw',
      });
      const drawn = await accepted(host);
      wins = drawn.snapshot.view.wins.length;
      expect(drawn.snapshot.view.phase).toBe('Running');
      expect(drawn.snapshot.view.revealedSeed).toBeNull();
    }
    expect(wins).toBe(1);
  });
  it('seats a mid-game departure again with the card and the marks it left with', async () => {
    const room = roomName('mid-game-return');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    const seated = await accepted(alice);
    await accepted(host);
    const [dealt] = seated.snapshot.view.cards;
    const { cells } = dealt;
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    await accepted(alice);
    const beforeDeparture = await drawUntilCardHit(host, [alice], cells);
    const departing = await nextSnapshotAfterResync(alice);
    const [atDeparture] = departing.view.cards;
    const { marked } = atDeparture;
    alice.send({
      type: 'command',
      command: 'Leave',
    });
    await accepted(alice);
    await accepted(host);
    const remaining = cells.filter(cell => !beforeDeparture.includes(cell));
    const awayDraws = await drawUntilCardHit(host, [alice], remaining);
    const away = remaining.find(cell => awayDraws.includes(cell));
    if (away === undefined) throw new Error('the draws taken during the absence missed the departed card');
    alice.send({
      type: 'command',
      command: 'Join',
    });
    const restored = await accepted(alice);
    await accepted(host);
    expect(restored.snapshot.view.cards.map(card => card.owner.subject)).toStrictEqual(['alice']);
    expect(restored.snapshot.view.cards[0].cells).toStrictEqual(cells);
    // The seat comes back with the card it left on, and the numbers called in the meantime count for it as if it had never been away.
    expect(restored.snapshot.view.cards[0].marked).toEqual(expect.arrayContaining(marked));
    expect(restored.snapshot.view.cards[0].marked).toContain(cells.indexOf(away));
  });
  it('gives a watcher every card while a seated player keeps only their own', async () => {
    const { room, host, alice, watcher } = await openWatchedGame('watched-projection');
    const watching = await nextSnapshotAfterResync(watcher);
    expect(watching.view.cards.map(card => card.owner.subject)).toStrictEqual(['host', 'alice']);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    const seated = await accepted(alice);
    const watched = await accepted(watcher);
    expect(watched.snapshot.view.cards.map(card => card.owner.subject)).toStrictEqual(['host', 'alice']);
    expect(seated.snapshot.view.cards.map(card => card.owner.subject)).toStrictEqual(['alice']);
    // Watching is not membership: the roster is who the room has seated, and it is what the next game deals itself to.
    expect(await rosterCount(room)).toBe(2);
    const watcherState = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: identityHeader('watcher'),
      },
    });
    expect(watcherState.status).toBe(403);
    expect(await watcherState.json()).toEqual({
      error: 'NotMember',
    });
    const seatedState = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: identityHeader('alice'),
      },
    });
    expect(seatedState.status).toBe(200);
    const message: ServerMessage = await seatedState.json();
    expect(message.type === 'snapshot' && message.view.cards.map(card => card.owner.subject)).toStrictEqual(['alice']);
  });
  it('redacts a watcher under restricted visibility the way it redacts the host', async () => {
    for (const [drawnVisibility, visible] of [
      ['LatestOnly', 1],
      ['Hidden', 0],
    ] as const) {
      const { host, alice, watcher } = await openWatchedGame('watched-redaction');
      host.send({
        type: 'settings',
        settings: {
          drawnVisibility,
        },
      });
      await accepted(host);
      await accepted(alice);
      await accepted(watcher);
      host.send({
        type: 'command',
        command: 'Start',
      });
      await accepted(host);
      await accepted(alice);
      await accepted(watcher);
      host.send({
        type: 'command',
        command: 'Draw',
      });
      await accepted(host);
      const seated = await accepted(alice);
      const watched = await accepted(watcher);
      expect(watched.snapshot.view.cards.map(card => card.owner.subject)).toStrictEqual(['host', 'alice']);
      for (const card of watched.snapshot.view.cards) {
        expect(card).toMatchObject({
          marked: [],
          bingo: [],
          reach: [],
        });
      }
      expect(watched.snapshot.view.drawn).toHaveLength(visible);
      expect(watched.snapshot.drawnOrder).toHaveLength(visible);
      expect(watched.events.events.some(event => 'NumberDrawn' in event)).toBe(false);
      // A watcher owns no card, so the only marks restricted visibility leaves anybody are the ones a seated player keeps on their own.
      expect(seated.snapshot.view.cards[0].marked.length).toBeGreaterThan(0);
    }
  });
  it('turns away a kicked player and the Join of a socket that outlived the kick', async () => {
    const room = roomName('kicked-return');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    /* The kick revokes every socket the target holds, so the wrapper's own refusal is reachable only for a socket that outlived one.
       It is written by hand here because nothing else can produce that order, and the guard is what keeps the engine from being asked at all. */
    await runInDurableObject(workerEnv.ROOM.getByName(room), (_instance, state) => {
      state.storage.sql.exec('INSERT INTO kicks (issuer, subject) VALUES (?, ?)', 'hmac', 'alice');
    });
    alice.send({
      type: 'command',
      command: 'Join',
    });
    const refusedJoin = await errorMessage(alice);
    expect(refusedJoin.code).toBe('JoinRejected');
    const closure = new Promise<CloseEvent>(resolve => {
      alice.socket.addEventListener('close', event => resolve(event), {
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
    const closed = await closure;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe('Kicked');
    const rejected = await workerExports.default.fetch(`https://example.test/rooms/${room}/ws`, {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: identityHeader('alice'),
        Upgrade: 'websocket',
      },
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({
      error: 'JoinRejected',
    });
    // The refusal hands back nothing to talk on, so the reason for it travels as the status rather than as a close frame.
    expect(rejected.webSocket).toBeNull();
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
  it('transfers immediately when the host kicks itself out of the room', async () => {
    const room = roomName('depart');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'host',
          },
        },
      },
    });
    const result = await accepted(alice);
    expect(result.snapshot.room.host.subject).toBe('alice');
    expect(result.events.events.some(event => 'HostTransferred' in event)).toBe(true);
  });
  it('keeps the room with a host who gives up a seat, and seats them again on return', async () => {
    const room = roomName('sitting-out-host');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    host.send({
      type: 'command',
      command: 'Leave',
    });
    const out = await accepted(host);
    await accepted(alice);
    // Calling a game and playing it are separate facts, so the seat goes and the room does not.
    expect(out.snapshot.room.host.subject).toBe('host');
    expect(out.snapshot.view.players.map(player => player.subject)).toStrictEqual(['alice']);
    expect(out.events.events.some(event => 'HostTransferred' in event)).toBe(false);
    expect(await deadlineAt(room, 'host_absent')).toBeNull();
    host.send({
      type: 'command',
      command: 'Join',
    });
    const back = await accepted(host);
    await accepted(alice);
    expect(back.snapshot.view.players.map(player => player.subject)).toStrictEqual(['alice', 'host']);
    expect(back.snapshot.room.host.subject).toBe('host');
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
  it('closes the game when a lone host quits and its absence expires', async () => {
    const room = roomName('lone-absence');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Start',
    });
    await accepted(host);
    // Quitting the activity is how someone leaves a room, so the socket closing is the departure the wrapper has to act on.
    await host.close();
    await scheduler.wait(10);
    const stub = workerEnv.ROOM.getByName(room);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE deadlines SET at = ? WHERE kind = ?', 1, 'host_absent');
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const rejoined = await openClient(room);
    const result = await nextSnapshot(rejoined);
    expect(result.view.phase).toBe('Finished');
    expect(result.view.revealedSeed).toBe(await storedSeed(room));
    await rejoined.close();
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
  it('starts the absence clock the moment the room is handed to someone who is not on a socket', async () => {
    const room = roomName('handover-absence');
    const host = await openClient(room);
    await nextSnapshot(host);
    const alice = await openClient(room, 'alice');
    await accepted(alice);
    await accepted(host);
    await alice.close();
    await scheduler.wait(10);
    // Alice is still a participant, so the room can be handed to her; she is simply not connected to receive it.
    expect(await deadlineAt(room, 'host_absent')).toBeNull();
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
    expect(await deadlineAt(room, 'host_absent')).not.toBeNull();
    await host.close();
  });
  it('closes instead of transferring when an auto-closing host is removed from the room', async () => {
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
      command: {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'host',
          },
        },
      },
    });
    const result = await accepted(alice);
    expect(result.snapshot.view.phase).toBe('Finished');
    expect(result.snapshot.view.revealedSeed).toBe(await storedSeed(room));
    expect(result.snapshot.room.host.subject).toBe('host');
    expect(result.events.events.some(event => 'GameClosed' in event)).toBe(true);
    expect(result.events.events.some(event => 'HostTransferred' in event)).toBe(false);
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
  it('ends the game when a lone host kicks itself out of the room', async () => {
    const room = roomName('lone-self-kick');
    const host = await openClient(room);
    await nextSnapshot(host);
    const closure = new Promise<void>(resolve => {
      host.socket.addEventListener('close', () => resolve(), {
        once: true,
      });
    });
    host.send({
      type: 'command',
      command: {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'host',
          },
        },
      },
    });
    await closure;
    expect(await deadlineAt(room, 'room_empty')).toBeGreaterThan(Date.now());
    const watching = await openClient(room, 'alice');
    const snapshot = await nextSnapshot(watching);
    expect(snapshot.view.phase).toBe('Finished');
    expect(snapshot.view.revealedSeed).toBe(await storedSeed(room));
    // Nobody was left to hand the room to, so it is still named for the host that ended it.
    expect(snapshot.room.host.subject).toBe('host');
  });
  it('hands the room to a watcher when the host kicks itself out of the game', async () => {
    const { room, host, watcher } = await openWatchedRoom('self-kick-watcher');
    const closure = new Promise<void>(resolve => {
      host.socket.addEventListener('close', () => resolve(), {
        once: true,
      });
    });
    host.send({
      type: 'command',
      command: {
        Kick: {
          target: {
            issuer: 'hmac',
            subject: 'host',
          },
        },
      },
    });
    await closure;
    const taken = await accepted(watcher);
    expect(taken.snapshot.room.host.subject).toBe('watcher');
    expect(taken.snapshot.view.host.subject).toBe('watcher');
    expect(taken.snapshot.view.phase).toBe('Lobby');
    expect(taken.events.events.some(event => 'PlayerKicked' in event)).toBe(true);
    // Only a player in the game can be its host, so the room changes hands and the game it is running does not.
    expect(taken.events.events.some(event => 'HostTransferred' in event)).toBe(false);
    expect(await gameHostSubject(room)).toBe('host');
  });
  it('lets a host-absence horizon lapse while the host is here, and hands the room to a watcher once it is not', async () => {
    const { room, host, watcher } = await openWatchedRoom('absence-with-watcher');
    await replaceDeadlines(room, [['host_absent', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(room))).toBe(true);
    expect(host.frames).toEqual([]);
    expect(watcher.frames).toEqual([]);
    const unchanged = await nextSnapshotAfterResync(host);
    expect(unchanged.room.host.subject).toBe('host');
    expect(unchanged.view.phase).toBe('Lobby');
    await host.close();
    await scheduler.wait(10);
    await replaceDeadlines(room, [['host_absent', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(room))).toBe(true);
    const taken = await accepted(watcher);
    expect(taken.snapshot.room.host.subject).toBe('watcher');
    expect(taken.events.events).toEqual([]);
    expect(await gameHostSubject(room)).toBe('host');
  });
  it('clears the horizons an old game armed once a new game has reseated the roster', async () => {
    const room = roomName('new-game-horizons');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Leave',
    });
    await accepted(host);
    expect(await deadlineAt(room, 'room_empty')).toBeGreaterThan(Date.now());
    // A host on a socket clears its own absence row on every presence pass, so a row for it to find has to be put back by hand.
    await replaceDeadlines(room, [
      ['room_empty', Date.now() + DEADLINE_HORIZONS.roomEmpty],
      ['host_absent', Date.now() + DEADLINE_HORIZONS.hostAbsent],
    ]);
    host.send({
      type: 'newGame',
      config: null,
    });
    const replacement = await replacementAccepted(host);
    expect(replacement.snapshot.room.gameIndex).toBe(1);
    expect(replacement.snapshot.view.players.map(player => player.subject)).toStrictEqual(['host']);
    expect(await deadlineAt(room, 'room_empty')).toBeNull();
    expect(await deadlineAt(room, 'host_absent')).toBeNull();
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
        [VERIFIED_IDENTITY_HEADER]: identityHeader(),
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
    expect(transferred.snapshot.view.host.subject).toBe('alice');
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
  it('arms the empty-room deadline when the last seat is given up, and clears it on return', async () => {
    const room = roomName('lone-departure');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Leave',
    });
    const result = await accepted(host);
    expect(result.snapshot.room.host.subject).toBe('host');
    // Nobody is playing, so the game is on the empty-room horizon — but its caller is still here, so it is still open.
    expect(result.snapshot.view.phase).toBe('Lobby');
    expect(await deadlineAt(room, 'room_empty')).toBeGreaterThan(Date.now());
    host.send({
      type: 'command',
      command: 'Join',
    });
    await accepted(host);
    expect(await deadlineAt(room, 'room_empty')).toBeNull();
  });
  it('discards a room once every connection has gone', async () => {
    const room = roomName('vacant-discard');
    const host = await openClient(room);
    await nextSnapshot(host);
    await host.close();
    await scheduler.wait(10);
    // Closing the last socket is what arms the deadline, so this is asserted on the real close rather than on a planted row.
    expect(await deadlineAt(room, 'room_vacant')).toBeGreaterThan(Date.now());
    await replaceDeadlines(room, [['room_vacant', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(room))).toBe(true);
    for (const table of ['games', 'events', 'snapshot', 'game_cache', 'roster', 'kicks', 'settings']) {
      expect(await rowCount(room, table)).toBe(0);
    }
    const response = await workerEnv.ROOM.getByName(room).fetch(internalRequest(room));
    expect(response.status).toBe(404);
  });
  it('keeps a room whose player has left the game but not the activity', async () => {
    const room = roomName('vacant-unseated');
    const host = await openClient(room);
    await nextSnapshot(host);
    host.send({
      type: 'command',
      command: 'Leave',
    });
    await accepted(host);
    // The seat is empty but the socket is not, so the room belongs to someone who is still looking at it.
    await replaceDeadlines(room, [['room_vacant', 1]]);
    expect(await runDurableObjectAlarm(workerEnv.ROOM.getByName(room))).toBe(true);
    expect(await rowCount(room, 'games')).toBeGreaterThan(0);
    const response = await workerEnv.ROOM.getByName(room).fetch(internalRequest(room));
    expect(response.status).toBe(200);
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
        [VERIFIED_IDENTITY_HEADER]: identityHeader('outsider'),
      },
    });
    expect(outsiderResponse.status).toBe(403);
    expect(await outsiderResponse.json()).toEqual({
      error: 'NotMember',
    });
    expect(await deadlineAt(room, 'room_gc')).toBe(1);
    const stateResponse = await workerExports.default.fetch(`https://example.test/rooms/${room}/state`, {
      headers: {
        [VERIFIED_IDENTITY_HEADER]: identityHeader(),
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
  it('keeps the game open when the removed room host is not the host the game was dealt under', async () => {
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
      const result = await accepted(host);
      /* Neither the hand-over nor the close the room asks for is the departing room host's to make, because the game answers to the host it was dealt under.
         The engine refuses both, and the room is left as it stood rather than holding a game nobody in it can account for. */
      expect(result.snapshot.room.host.subject).toBe('alice');
      expect(result.snapshot.view.phase).toBe('Lobby');
      expect(result.events.events.some(event => 'HostTransferred' in event || 'GameClosed' in event)).toBe(false);
      expect(await gameHostSubject(room)).toBe('host');
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
    const second = await openClient(room, 'host', {}, 'Second Host', 'second');
    await accepted(second);
    await accepted(host);
    expect(await rosterCount(room)).toBe(2);
    await second.close();
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
