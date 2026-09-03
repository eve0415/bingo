import type { PlayerIdentity } from '../app/identity';

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { mintRoomToken } from '../app/identity';
import { forward, identify } from '../app/proxy';

const ROOM = 'i-1-gc-2-3';
const OTHER_ROOM = 'i-1-gc-2-4';
const SUPPLIED_IDENTITY = '{"player":{"issuer":"browser","subject":"attacker"},"displayName":"Attacker"}';
const PLAYER_ONE = {
  player: {
    issuer: 'discord',
    subject: 'player-1',
  },
  displayName: 'Player One',
};

const mintValidToken = async (room = ROOM): Promise<string> =>
  mintRoomToken('test-session-secret', {
    issuer: 'discord',
    subject: 'player-1',
    displayName: 'Player One',
    room,
    lifetimeSeconds: 60,
  });

const request = (headers: Record<string, string> = {}, path = `/rooms/${ROOM}/state`): Request =>
  new Request(`https://activity.test${path}`, {
    headers,
  });

const bearing = async (room = ROOM): Promise<Record<string, string>> => ({
  Authorization: `Bearer ${await mintValidToken(room)}`,
});

const refusal = (identified: PlayerIdentity | Response): Response => {
  if (!(identified instanceof Response)) throw new Error(`expected a refusal, got ${identified.displayName}`);
  return identified;
};

describe('identifying a room caller', () => {
  it('refuses a request with no token', async (): Promise<void> => {
    const response = refusal(await identify(request()));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: 'MissingAuthorization',
    });
  });

  it('refuses a malformed token', async (): Promise<void> => {
    const response = refusal(
      await identify(
        request({
          Authorization: 'Bearer malformed',
        }),
      ),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a token minted for a different room', async (): Promise<void> => {
    const headers = await bearing(OTHER_ROOM);
    const response = refusal(await identify(request(headers)));
    expect(response.status).toBe(401);
  });

  it('names the player a valid token belongs to', async (): Promise<void> => {
    const headers = await bearing();
    expect(await identify(request(headers))).toEqual(PLAYER_ONE);
  });

  it('accepts a valid token from the WebSocket subprotocol', async (): Promise<void> => {
    const identity = await identify(
      request(
        {
          'Sec-WebSocket-Protocol': `  ${await mintValidToken()}, another-protocol`,
        },
        `/rooms/${ROOM}/ws`,
      ),
    );
    expect(identity).toEqual(PLAYER_ONE);
  });

  it('does not fall back to a subprotocol when Authorization is not Bearer', async (): Promise<void> => {
    const token = await mintValidToken();
    const response = refusal(
      await identify(
        request(
          {
            Authorization: `Token ${token}`,
            'Sec-WebSocket-Protocol': token,
          },
          `/rooms/${ROOM}/ws`,
        ),
      ),
    );
    expect(response.status).toBe(401);
  });

  // The wrapper reads the same segment from the same url, so an escaped separator names a room rather than splitting the path.
  it('authorizes the room the path names, not the one a separator would suggest', async (): Promise<void> => {
    const escaped = `/rooms/${encodeURIComponent(`${ROOM}/state`)}`;
    const untokened = refusal(await identify(request({}, escaped)));
    expect(untokened.status).toBe(401);
    const headers = await bearing(`${ROOM}/state`);
    expect(await identify(request(headers, escaped))).toEqual(PLAYER_ONE);
  });

  it('refuses a room segment that is not decodable', async (): Promise<void> => {
    const headers = await bearing();
    const response = refusal(await identify(request(headers, '/rooms/a%zz/state')));
    expect(response.status).toBe(401);
  });

  it('refuses a path that names no room at all', async (): Promise<void> => {
    const headers = await bearing();
    const response = refusal(await identify(request(headers, '/rooms/')));
    expect(response.status).toBe(401);
  });

  it('reports a missing session signing secret', async (): Promise<void> => {
    const secret = env.SESSION_HMAC_SECRET;
    env.SESSION_HMAC_SECRET = '';
    try {
      const response = refusal(await identify(request()));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        error: 'MissingSessionSecret',
      });
    } finally {
      env.SESSION_HMAC_SECRET = secret;
    }
  });
});

describe('crossing the binding', () => {
  it('states the identity it was given', async (): Promise<void> => {
    const response = await forward(request(), PLAYER_ONE);
    expect(await response.json()).toEqual({
      identity: JSON.stringify(PLAYER_ONE),
      path: `/rooms/${ROOM}/state`,
    });
  });

  it('removes a browser-supplied identity when there is none to state', async (): Promise<void> => {
    const response = await forward(
      request(
        {
          'x-bingo-verified-identity': SUPPLIED_IDENTITY,
        },
        '/health',
      ),
      null,
    );
    expect(await response.json()).toEqual({
      identity: null,
      path: '/health',
    });
  });

  it('replaces a browser-supplied identity with the one it was given', async (): Promise<void> => {
    const response = await forward(
      request({
        'x-bingo-verified-identity': SUPPLIED_IDENTITY,
      }),
      PLAYER_ONE,
    );
    expect(await response.json()).toMatchObject({
      identity: JSON.stringify(PLAYER_ONE),
    });
  });
});
