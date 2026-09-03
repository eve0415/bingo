import { safeParse } from 'valibot';

import { claimsSchema } from './token';

/** The wire contract with the wrapper: a consumer states who the caller is, and the wrapper trusts it because only a service binding can reach it. */
export const VERIFIED_IDENTITY_HEADER = 'x-bingo-verified-identity';

const encoder = new TextEncoder();
const HASH = {
  name: 'HMAC',
  hash: 'SHA-256',
} as const;

/** Base64url is base64 with two characters swapped and the padding dropped. */
const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const fromBase64Url = (value: string): Uint8Array | null => {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const segment = (value: unknown): string => base64url(encoder.encode(JSON.stringify(value)));

const parseJson = (value: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
};

const keyFor = async (secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), HASH, false, [usage]);

export interface PlayerIdentity {
  player: {
    issuer: string;
    subject: string;
  };
  displayName: string;
}

export interface RoomClaim {
  /** The player namespace this consumer mints under, which keeps its subjects distinct from another consumer's. */
  issuer: string;
  subject: string;
  displayName: string;
  room: string;
  lifetimeSeconds: number;
}

/** Mints this activity's own session token; only this worker ever verifies it, and the wrapper never sees it. */
export const mintRoomToken = async (secret: string, claim: RoomClaim): Promise<string> => {
  const header = segment({
    alg: 'HS256',
  });
  const claims = segment({
    iss: claim.issuer,
    sub: claim.subject,
    exp: Math.floor(Date.now() / 1000) + claim.lifetimeSeconds,
    room: claim.room,
    name: claim.displayName,
  });
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret, 'sign'), encoder.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
};

/** Resolves a presented token to the player it names, or null when it is not this worker's token for this room. */
export const verifyRoomToken = async (secret: string, token: string, room: string): Promise<PlayerIdentity | null> => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, claims, signature] = parts;
  const bytes = fromBase64Url(signature);
  if (bytes === null) return null;
  const valid = await crypto.subtle.verify('HMAC', await keyFor(secret, 'verify'), new Uint8Array(bytes).buffer, encoder.encode(`${header}.${claims}`));
  if (!valid) return null;
  const decoded = fromBase64Url(claims);
  if (decoded === null) return null;
  const claimValue = parseJson(new TextDecoder().decode(decoded));
  const parsed = safeParse(claimsSchema, claimValue);
  if (!parsed.success) return null;
  if (parsed.output.room !== room) return null;
  if (parsed.output.exp <= Math.floor(Date.now() / 1000)) return null;
  return {
    player: {
      issuer: parsed.output.iss,
      subject: parsed.output.sub,
    },
    displayName: parsed.output.name,
  };
};
