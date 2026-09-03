import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { mintRoomToken } from '../app/identity';

const ROOM = 'i-1-gc-2-3';
const VERIFIED_PLAYER = JSON.stringify({
  player: {
    issuer: 'discord',
    subject: 'player-1',
  },
  displayName: 'Player One',
});

const mintValidToken = async (): Promise<string> =>
  mintRoomToken('test-session-secret', {
    issuer: 'discord',
    subject: 'player-1',
    displayName: 'Player One',
    room: ROOM,
    lifetimeSeconds: 60,
  });

const tokened = async (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  exports.default.fetch(`https://activity.test${path}`, {
    headers: {
      Authorization: `Bearer ${await mintValidToken()}`,
      ...headers,
    },
  });

describe('activity worker', () => {
  it('serves the page', async (): Promise<void> => {
    const response = await exports.default.fetch('https://activity.test/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
  });

  it('serves the discord client id', async (): Promise<void> => {
    const response = await exports.default.fetch('https://activity.test/api/config');
    expect(await response.json()).toEqual({
      clientId: 'test-client-id',
    });
  });

  it('rejects a token exchange that names no code', async (): Promise<void> => {
    const response = await exports.default.fetch('https://activity.test/api/token', {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'MissingCode',
    });
  });

  it('reaches the wrapper without an identity on the health route', async (): Promise<void> => {
    const response = await exports.default.fetch('https://activity.test/health', {
      headers: {
        'x-bingo-verified-identity': '{"player":{"issuer":"browser","subject":"attacker"},"displayName":"Attacker"}',
      },
    });
    expect(await response.json()).toEqual({
      identity: null,
      path: '/health',
    });
  });
});

// The gate lives on the room's parent route, so these hold for every path under a room rather than only the ones that exist today.
describe('reaching a room', () => {
  it.each(['/state', '/ws', '/games/7/log', '/', ''])('refuses %s without a token', async (suffix: string): Promise<void> => {
    const response = await exports.default.fetch(`https://activity.test/rooms/${ROOM}${suffix}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: 'MissingAuthorization',
    });
  });

  it.each(['/state', '/games/7/log'])('carries the verified identity across the binding on %s', async (suffix: string): Promise<void> => {
    const response = await tokened(`/rooms/${ROOM}${suffix}`);
    expect(await response.json()).toEqual({
      identity: VERIFIED_PLAYER,
      path: `/rooms/${ROOM}${suffix}`,
    });
  });

  it('states the verified identity in place of one the browser supplied', async (): Promise<void> => {
    const response = await tokened(`/rooms/${ROOM}/state`, {
      'x-bingo-verified-identity': '{"player":{"issuer":"browser","subject":"attacker"},"displayName":"Attacker"}',
    });
    expect(await response.json()).toMatchObject({
      identity: VERIFIED_PLAYER,
    });
  });

  it('returns the wrapper upgrade, socket and all', async (): Promise<void> => {
    const response = await exports.default.fetch(`https://activity.test/rooms/${ROOM}/ws`, {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': await mintValidToken(),
      },
    });
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).toBeInstanceOf(WebSocket);
    const delivered = new Promise<string>(resolve => {
      socket?.addEventListener('message', event => resolve(String(event.data)));
    });
    socket?.accept();
    expect(JSON.parse(await delivered)).toEqual({
      identity: VERIFIED_PLAYER,
      path: `/rooms/${ROOM}/ws`,
    });
  });
});
