import { describe, expect, it } from 'vitest';

import { mintRoomToken, verifyRoomToken } from '../app/identity';

const SECRET = 'identity-test-secret';
const ROOM = 'room-a';
const encoder = new TextEncoder();

const encodeBase64Url = (value: string | Uint8Array): string => {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
};

const signClaimsSegment = async (claims: string): Promise<string> => {
  const header = encodeBase64Url(
    JSON.stringify({
      alg: 'HS256',
    }),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signed = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signed));
  return `${signed}.${encodeBase64Url(new Uint8Array(signature))}`;
};

const mintValidToken = async (room = ROOM, lifetimeSeconds = 60): Promise<string> =>
  mintRoomToken(SECRET, {
    issuer: 'discord',
    subject: 'player-1',
    displayName: 'Player One',
    room,
    lifetimeSeconds,
  });

describe('room identity tokens', () => {
  it('mints and verifies a room-bound player identity', async (): Promise<void> => {
    expect(await verifyRoomToken(SECRET, await mintValidToken(), ROOM)).toEqual({
      player: {
        issuer: 'discord',
        subject: 'player-1',
      },
      displayName: 'Player One',
    });
  });

  it('rejects a token with the wrong segment count', async (): Promise<void> => {
    expect(await verifyRoomToken(SECRET, 'header.claims', ROOM)).toBeNull();
  });

  it('rejects an unparseable base64url signature', async (): Promise<void> => {
    expect(await verifyRoomToken(SECRET, 'header.claims.%', ROOM)).toBeNull();
  });

  it('rejects a bad signature', async (): Promise<void> => {
    const token = await mintValidToken();
    expect(await verifyRoomToken('different-secret', token, ROOM)).toBeNull();
  });

  it('rejects unparseable base64url claims', async (): Promise<void> => {
    expect(await verifyRoomToken(SECRET, await signClaimsSegment('%'), ROOM)).toBeNull();
  });

  it('rejects signed claims that are not JSON', async (): Promise<void> => {
    const claims = encodeBase64Url('not json');
    expect(await verifyRoomToken(SECRET, await signClaimsSegment(claims), ROOM)).toBeNull();
  });

  it('rejects signed claims that fail the schema', async (): Promise<void> => {
    const expiration = Math.floor(Date.now() / 1000) + 60;
    const claims = encodeBase64Url(
      JSON.stringify({
        iss: '',
        sub: 'player-1',
        exp: expiration,
        room: ROOM,
        name: 'Player One',
      }),
    );
    expect(await verifyRoomToken(SECRET, await signClaimsSegment(claims), ROOM)).toBeNull();
  });

  it('rejects a valid token presented for a different room', async (): Promise<void> => {
    expect(await verifyRoomToken(SECRET, await mintValidToken(ROOM), 'room-b')).toBeNull();
  });

  it('rejects an expired token', async (): Promise<void> => {
    expect(await verifyRoomToken(SECRET, await mintValidToken(ROOM, -1), ROOM)).toBeNull();
  });
});
