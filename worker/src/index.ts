import type { Context } from 'hono';

import { Hono } from 'hono';

import {
  GAME_INDEX_HEADER,
  ROOM_KEY_HEADER,
  ROOM_MODE_HEADER,
  SELECTED_PROTOCOL_HEADER,
  VERIFIED_IDENTITY_HEADER,
  encodeIdentity,
  verifyIdentity,
} from './identity';

interface AppBindings {
  ROOM: Env['ROOM'];
  IDENTITY_HMAC_SECRET?: string;
}
interface AppEnvironment {
  Bindings: AppBindings;
}
const app = new Hono<AppEnvironment>();
const forward = async (context: Context<AppEnvironment>, mode: 'log' | 'state' | 'websocket'): Promise<Response> => {
  if (mode === 'websocket' && context.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return context.json(
      {
        error: 'UpgradeRequired',
      },
      426,
    );
  }
  const roomId = String(context.req.param('id'));
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(roomId)) {
    return context.json(
      {
        error: 'InvalidRoomId',
      },
      400,
    );
  }
  const offeredProtocol = context.req.header('Sec-WebSocket-Protocol')?.split(',')[0]?.trim();
  const authorization = context.req.header('Authorization') ?? (mode === 'websocket' && offeredProtocol ? `Bearer ${offeredProtocol}` : undefined);
  const headers = new Headers(context.req.raw.headers);
  headers.delete(VERIFIED_IDENTITY_HEADER);
  headers.delete(ROOM_KEY_HEADER);
  headers.delete(ROOM_MODE_HEADER);
  headers.delete(GAME_INDEX_HEADER);
  headers.delete(SELECTED_PROTOCOL_HEADER);
  headers.delete('Authorization');
  headers.delete('Sec-WebSocket-Protocol');
  if (mode !== 'websocket') headers.delete('Upgrade');
  const verified = await verifyIdentity(authorization, {
    hmac: context.env.IDENTITY_HMAC_SECRET,
  });
  if (!verified.ok) {
    return context.json(
      {
        error: verified.code,
      },
      verified.code === 'MissingIdentitySecret' ? 500 : 401,
    );
  }
  headers.set(VERIFIED_IDENTITY_HEADER, encodeIdentity(verified.identity));
  headers.set(ROOM_KEY_HEADER, roomId);
  headers.set(ROOM_MODE_HEADER, mode);
  if (mode === 'log') headers.set(GAME_INDEX_HEADER, String(context.req.param('gameIndex')));
  if (context.req.header('Authorization') === undefined && offeredProtocol !== undefined) {
    headers.set(SELECTED_PROTOCOL_HEADER, offeredProtocol);
  }
  const request = new Request(`https://room.internal/rooms/${roomId}`, {
    method: 'GET',
    headers,
  });
  return context.env.ROOM.getByName(roomId).fetch(request);
};
app.get('/health', context =>
  context.json({
    ok: true,
  }),
);
app.get('/rooms/:id/ws', async context => forward(context, 'websocket'));
app.get('/rooms/:id/state', async context => forward(context, 'state'));
app.get('/rooms/:id/games/:gameIndex/log', async context => {
  if (!/^(?:0|[1-9]\d{0,9})$/u.test(context.req.param('gameIndex'))) {
    return context.json(
      {
        error: 'InvalidGameIndex',
      },
      400,
    );
  }
  return forward(context, 'log');
});
export { Room } from './room';
export default app;
