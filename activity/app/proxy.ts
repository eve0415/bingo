import type { PlayerIdentity } from './identity';

import { env } from 'cloudflare:workers';

import { configured } from './env';
import { failure } from './failure';
import { VERIFIED_IDENTITY_HEADER, verifyRoomToken } from './identity';

/** Browsers cannot set headers on a WebSocket, so the token rides the subprotocol on that one path. */
const presentedToken = (authorization: string | null, offeredProtocol: string | null): string | null => {
  if (authorization !== null) return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  return offeredProtocol;
};

/**
 * The room the caller is asking about, read from the url this worker will forward rather than from the matched parameters.
 * The wrapper decodes that same segment for itself, so authorizing whatever it decodes to is what keeps the two readings identical.
 */
const addressedRoom = (pathname: string): string | null => {
  const segment = /^\/rooms\/(?<room>[^/]+)/u.exec(pathname)?.groups?.room;
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
};

/**
 * Resolves who is asking, or the refusal to send instead.
 * Identification belongs to this worker rather than to the wrapper, which is reachable only over the binding and trusts whatever states an identity across it.
 */
export const identify = async (request: Request): Promise<PlayerIdentity | Response> => {
  const secret = configured(env.SESSION_HMAC_SECRET);
  if (secret === null) return failure('MissingSessionSecret', 500);
  const room = addressedRoom(new URL(request.url).pathname);
  const token = presentedToken(request.headers.get('Authorization'), request.headers.get('Sec-WebSocket-Protocol')?.split(',')[0]?.trim() ?? null);
  const identity = room === null || token === null ? null : await verifyRoomToken(secret, token, room);
  return identity ?? failure('MissingAuthorization', 401);
};

/**
 * The one way anything reaches the wrapper: the header it trusts is dropped and restated here, so no route can forward one a browser supplied.
 * The response is handed back as it arrives, because an upgrade carries its socket on the object itself and a copy would leave it behind.
 */
export const forward = async (request: Request, identity: PlayerIdentity | null): Promise<Response> => {
  const crossing = new Request(request);
  crossing.headers.delete(VERIFIED_IDENTITY_HEADER);
  if (identity !== null) crossing.headers.set(VERIFIED_IDENTITY_HEADER, JSON.stringify(identity));
  return await env.WRAPPER.fetch(crossing);
};
