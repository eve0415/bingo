import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { InferOutput } from 'valibot';

import { check, finite, maxLength, nonEmpty, number, object, optional, pipe, safeParse, strictObject, string, transform, unknown } from 'valibot';

export const VERIFIED_IDENTITY_HEADER = 'x-bingo-verified-identity';
export const ROOM_KEY_HEADER = 'x-bingo-room-key';
export const ROOM_MODE_HEADER = 'x-bingo-room-mode';
export const GAME_INDEX_HEADER = 'x-bingo-game-index';
export const SELECTED_PROTOCOL_HEADER = 'x-bingo-selected-protocol';
const MAX_IDENTITY_TEXT_LENGTH = 256;
export const playerIdSchema = strictObject({
  issuer: string(),
  subject: string(),
});
export const verifiedIdentitySchema = strictObject({
  player: playerIdSchema,
  displayName: string(),
});
const tokenHeaderSchema = object({
  alg: string(),
});
const subjectSchema = pipe(string(), nonEmpty(), maxLength(MAX_IDENTITY_TEXT_LENGTH));
const expirationSchema = pipe(number(), finite());
const rawTokenClaimsSchema = object({
  iss: string(),
  sub: subjectSchema,
  exp: expirationSchema,
  room: string(),
  name: optional(unknown()),
});
const tokenClaimsSchema = pipe(
  rawTokenClaimsSchema,
  transform(claims => ({
    issuer: claims.iss,
    subject: claims.sub,
    expiresAt: claims.exp,
    room: claims.room,
    displayName: typeof claims.name === 'string' && claims.name.length > 0 ? claims.name : claims.sub,
  })),
  check(claims => claims.displayName.length <= MAX_IDENTITY_TEXT_LENGTH),
);
type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;
export type PlayerIdSchemaMatchesGenerated = Assert<Equal<InferOutput<typeof playerIdSchema>, PlayerIdDto>>;

export type VerifiedIdentity = InferOutput<typeof verifiedIdentitySchema>;
export type IdentityResult =
  | {
      ok: true;
      identity: VerifiedIdentity;
    }
  | {
      ok: false;
      code: string;
    };
interface TokenParts {
  encodedHeader: string;
  encodedClaims: string;
  encodedSignature: string;
}
type TokenClaims = InferOutput<typeof tokenClaimsSchema>;
export interface IdentitySecrets {
  hmac: string | undefined;
}
interface IssuerVerifier {
  algorithm: string;
  signingSecret: (secrets: IdentitySecrets) => string | undefined;
  verify: (signingInput: string, signature: Uint8Array, secret: string) => Promise<boolean>;
}
const decodeBase64Url = (value: string): Uint8Array | null => {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    return null;
  }
};
const decodeJson = (value: string): unknown => {
  const bytes = decodeBase64Url(value);
  if (bytes === null) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};
export const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const parseToken = (value: string): TokenParts | null => {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  if (encodedHeader.length === 0 || encodedClaims.length === 0 || encodedSignature.length === 0) {
    return null;
  }
  return {
    encodedHeader,
    encodedClaims,
    encodedSignature,
  };
};
const parseClaims = (value: unknown): TokenClaims | null => {
  const result = safeParse(tokenClaimsSchema, value);
  return result.success ? result.output : null;
};
const verifyHmac = async (signingInput: string, signature: Uint8Array, secret: string): Promise<boolean> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, new Uint8Array(signature).buffer, new TextEncoder().encode(signingInput));
};
const ISSUERS = new Map<string, IssuerVerifier>([
  [
    'hmac',
    {
      algorithm: 'HS256',
      signingSecret: (secrets): string | undefined => secrets.hmac,
      verify: verifyHmac,
    },
  ],
]);
export const verifyIdentity = async (authorization: string | undefined, roomId: string, secrets: IdentitySecrets): Promise<IdentityResult> => {
  if (authorization === undefined || !authorization.startsWith('Bearer ')) {
    return {
      ok: false,
      code: 'MissingAuthorization',
    };
  }
  const token = parseToken(authorization.slice(7));
  if (token === null) {
    return {
      ok: false,
      code: 'MalformedToken',
    };
  }
  const header = decodeJson(token.encodedHeader);
  const parsedHeader = safeParse(tokenHeaderSchema, header);
  if (!parsedHeader.success) {
    return {
      ok: false,
      code: 'UnsupportedAlgorithm',
    };
  }
  const claims = parseClaims(decodeJson(token.encodedClaims));
  if (claims === null) {
    return {
      ok: false,
      code: 'InvalidClaims',
    };
  }
  const verifier = ISSUERS.get(claims.issuer);
  if (verifier === undefined) {
    return {
      ok: false,
      code: 'UnknownIssuer',
    };
  }
  if (parsedHeader.output.alg !== verifier.algorithm) {
    return {
      ok: false,
      code: 'UnsupportedAlgorithm',
    };
  }
  const secret = verifier.signingSecret(secrets);
  if (secret === undefined || secret.length === 0) {
    return {
      ok: false,
      code: 'MissingIdentitySecret',
    };
  }
  const signature = decodeBase64Url(token.encodedSignature);
  if (signature === null) {
    return {
      ok: false,
      code: 'MalformedToken',
    };
  }
  const valid = await verifier.verify(`${token.encodedHeader}.${token.encodedClaims}`, signature, secret);
  if (!valid) {
    return {
      ok: false,
      code: 'BadSignature',
    };
  }
  if (claims.expiresAt <= Math.floor(Date.now() / 1000)) {
    return {
      ok: false,
      code: 'ExpiredToken',
    };
  }
  if (claims.room !== roomId) {
    return {
      ok: false,
      code: 'RoomMismatch',
    };
  }
  return {
    ok: true,
    identity: {
      player: {
        issuer: claims.issuer,
        subject: claims.subject,
      },
      displayName: claims.displayName,
    },
  };
};
export const encodeIdentity = (identity: VerifiedIdentity): string => JSON.stringify(identity);
export const decodeIdentity = (value: string | null): VerifiedIdentity | null => {
  if (value === null) return null;
  const result = safeParse(verifiedIdentitySchema, parseJson(value));
  return result.success ? result.output : null;
};
