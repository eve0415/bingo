import { safeParse } from 'valibot';

import { configured } from './env';
import { failure } from './failure';
import { mintRoomToken } from './identity';
import { accessTokenSchema, discordUserSchema, instanceSchema, oauthErrorSchema, tokenRequestSchema } from './token';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';
const ACTIVITY_INSTANCES_URL = 'https://discord.com/api/applications';
/** The player namespace this activity mints under, which keeps its subjects distinct from another front end's. */
export const ISSUER = 'discord';
/** Long enough to outlast a game, short enough that a leaked token stops working. */
const TOKEN_LIFETIME_SECONDS = 6 * 60 * 60;

export interface SessionEnvironment {
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  SESSION_HMAC_SECRET?: string;
}

/** The application id is public, and serving it keeps the deployment's single copy of it in the worker's environment. */
export const activityConfig = (environment: SessionEnvironment): Response => {
  const clientId = configured(environment.DISCORD_CLIENT_ID);
  return clientId === null
    ? failure('MissingDiscordCredentials', 500)
    : Response.json({
        clientId,
      });
};

/** Exchanges an authorization code for the player it belongs to, and mints this activity's own session token for their room. */
export const createSession = async (environment: SessionEnvironment, request: Request): Promise<Response> => {
  const requested = safeParse(tokenRequestSchema, await request.json().catch(() => null));
  if (!requested.success) return failure('MissingCode', 400);
  const clientId = configured(environment.DISCORD_CLIENT_ID);
  const clientSecret = configured(environment.DISCORD_CLIENT_SECRET);
  if (clientId === null || clientSecret === null) return failure('MissingDiscordCredentials', 500);
  const botToken = configured(environment.DISCORD_BOT_TOKEN);
  const sessionSecret = configured(environment.SESSION_HMAC_SECRET);
  if (botToken === null || sessionSecret === null) return failure('MissingIdentityCredentials', 500);
  // The activity starter posts the code without a redirect_uri, which a real launch confirmed this endpoint accepts.
  const exchanged = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: requested.output.code,
    }),
  });
  if (!exchanged.ok) {
    // Discord's own reason is the only actionable thing here, and it is an OAuth error code rather than anything sensitive.
    const rejection = safeParse(oauthErrorSchema, await exchanged.json().catch(() => null));
    return failure('TokenExchangeRejected', 502, rejection.success ? rejection.output.error : `discord returned ${exchanged.status}`);
  }
  const issued = safeParse(accessTokenSchema, await exchanged.json().catch(() => null));
  if (!issued.success) return failure('TokenExchangeMalformed', 502);
  // Asking Discord who the token belongs to is the only way to learn the player's identity without taking the client's word for it.
  const account = await fetch(DISCORD_USER_URL, {
    headers: {
      Authorization: `Bearer ${issued.output.access_token}`,
    },
  });
  if (!account.ok) return failure('UserLookupRejected', 502, `discord returned ${account.status}`);
  const user = safeParse(discordUserSchema, await account.json().catch(() => null));
  if (!user.success) return failure('UserLookupMalformed', 502);
  // The claimed instance is the client's word; asking Discord who is actually in it is what makes it a claim worth honouring.
  const instance = await fetch(`${ACTIVITY_INSTANCES_URL}/${clientId}/activity-instances/${encodeURIComponent(requested.output.instanceId)}`, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  });
  if (!instance.ok) return failure('InstanceLookupRejected', 502, `discord returned ${instance.status}`);
  const participants = safeParse(instanceSchema, await instance.json().catch(() => null));
  if (!participants.success) return failure('InstanceLookupMalformed', 502);
  if (!participants.output.users.includes(user.output.id)) return failure('NotInInstance', 403);
  const displayName = user.output.global_name ?? user.output.username;
  return Response.json({
    access_token: issued.output.access_token,
    user: {
      id: user.output.id,
      displayName,
    },
    roomToken: await mintRoomToken(sessionSecret, {
      issuer: ISSUER,
      subject: user.output.id,
      displayName,
      room: requested.output.instanceId,
      lifetimeSeconds: TOKEN_LIFETIME_SECONDS,
    }),
  });
};
