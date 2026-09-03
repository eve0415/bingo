import { array, nonEmpty, nullish, number, object, optional, pipe, strictObject, string } from 'valibot';

/** Every identifier this activity carries is a non-empty string, and naming it once keeps the schemas below shallow. */
const identifier = pipe(string(), nonEmpty());

/** The activity's own request vocabulary, so unknown keys are a mistake rather than something to tolerate. */
export const tokenRequestSchema = strictObject({
  code: identifier,
  instanceId: identifier,
});

/** Discord's token response, and this activity's relay of it; both carry fields beyond the one that is read. */
export const accessTokenSchema = object({
  access_token: identifier,
});

/** Discord answers a rejected exchange with an OAuth error code, which is the only useful thing to say about it. */
export const oauthErrorSchema = object({
  error: identifier,
});

/** This activity's own failure shape, so the page can say why rather than only that it failed. */
export const failureSchema = object({
  error: identifier,
  detail: optional(string()),
});

/** What the page needs before it can construct the SDK, served rather than baked into the bundle. */
export const configSchema = object({
  clientId: identifier,
});

/** Discord's own account record for the bearer of an access token, which is the only identity a backend may trust. */
export const discordUserSchema = object({
  id: identifier,
  username: identifier,
  global_name: nullish(string()),
});

/** What this activity's own exchange returns: the token the SDK needs, plus the identity the worker derived rather than accepted. */
export const sessionSchema = object({
  access_token: identifier,
  user: object({
    id: identifier,
    displayName: identifier,
  }),
  roomToken: identifier,
});

/** The activity instance's live participants, which is how a claimed instance is checked against the player who claimed it. */
export const instanceSchema = object({
  users: array(identifier),
});

/** The claims this activity signs into its own session token and reads back out of it. */
export const claimsSchema = object({
  iss: identifier,
  sub: identifier,
  exp: number(),
  room: identifier,
  name: identifier,
});
