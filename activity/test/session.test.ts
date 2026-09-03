import type { SessionEnvironment } from '../app/session';

import { safeParse } from 'valibot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyRoomToken } from '../app/identity';
import { activityConfig, createSession } from '../app/session';
import { sessionSchema } from '../app/token';

const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USER_URL = 'https://discord.com/api/users/@me';
const INSTANCE_ID = 'instance-1';
const INSTANCE_URL = `https://discord.com/api/applications/test-client-id/activity-instances/${INSTANCE_ID}`;
const ACCESS_TOKEN = 'discord-access-token';
const FORM_BODY = 'client_id=test-client-id&client_secret=test-client-secret&grant_type=authorization_code&code=authorization-code';

const SESSION_ENVIRONMENT: SessionEnvironment = {
  DISCORD_CLIENT_ID: 'test-client-id',
  DISCORD_CLIENT_SECRET: 'test-client-secret',
  DISCORD_BOT_TOKEN: 'test-bot-token',
  SESSION_HMAC_SECRET: 'test-session-secret',
};

interface ExpectedDiscordRequest {
  url: string;
  method: 'GET' | 'POST';
  authorization: string | null;
  contentType: string | null;
  body: string;
  status: number;
  responseBody: string;
}

let pendingDiscordRequests: ExpectedDiscordRequest[] = [];

const exchangeRequest = (responseBody: string, status = 200): ExpectedDiscordRequest => ({
  url: TOKEN_URL,
  method: 'POST',
  authorization: null,
  contentType: 'application/x-www-form-urlencoded',
  body: FORM_BODY,
  status,
  responseBody,
});

const userRequest = (responseBody: string, status = 200): ExpectedDiscordRequest => ({
  url: USER_URL,
  method: 'GET',
  authorization: `Bearer ${ACCESS_TOKEN}`,
  contentType: null,
  body: '',
  status,
  responseBody,
});

const instanceRequest = (responseBody: string, status = 200): ExpectedDiscordRequest => ({
  url: INSTANCE_URL,
  method: 'GET',
  authorization: 'Bot test-bot-token',
  contentType: null,
  body: '',
  status,
  responseBody,
});

const expectDiscordRequests = (...requests: ExpectedDiscordRequest[]): void => {
  pendingDiscordRequests.push(...requests);
};

const sessionRequest = (body = JSON.stringify({ code: 'authorization-code', instanceId: INSTANCE_ID })): Request =>
  new Request('https://activity.test/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

const expectFailure = async (response: Response, status: number, error: string, detail?: string): Promise<void> => {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(detail === undefined ? { error } : { error, detail });
};

const expectSuccessfulSession = async (globalName: string | undefined, expectedDisplayName: string): Promise<void> => {
  expectDiscordRequests(
    exchangeRequest(JSON.stringify({ access_token: ACCESS_TOKEN, token_type: 'Bearer' })),
    userRequest(
      JSON.stringify({
        id: 'player-1',
        username: 'discord-username',
        global_name: globalName,
      }),
    ),
    instanceRequest(JSON.stringify({ users: ['player-1', 'player-2'] })),
  );
  const response = await createSession(SESSION_ENVIRONMENT, sessionRequest());
  expect(response.status).toBe(200);
  const parsed = safeParse(sessionSchema, await response.json());
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('session response did not match its schema');
  expect(parsed.output).toMatchObject({
    access_token: ACCESS_TOKEN,
    user: {
      id: 'player-1',
      displayName: expectedDisplayName,
    },
  });
  expect(await verifyRoomToken('test-session-secret', parsed.output.roomToken, INSTANCE_ID)).toEqual({
    player: {
      issuer: 'discord',
      subject: 'player-1',
    },
    displayName: expectedDisplayName,
  });
};

beforeEach((): void => {
  pendingDiscordRequests = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init): Promise<Response> => {
    const expectedRequest = pendingDiscordRequests.shift();
    if (expectedRequest === undefined) throw new Error('unexpected unmocked Discord request');
    const request = new Request(input, init);
    expect(request.url).toBe(expectedRequest.url);
    expect(request.method).toBe(expectedRequest.method);
    expect(request.headers.get('Authorization')).toBe(expectedRequest.authorization);
    expect(request.headers.get('Content-Type')).toBe(expectedRequest.contentType);
    expect(new TextDecoder().decode(await request.arrayBuffer())).toBe(expectedRequest.body);
    return new Response(expectedRequest.responseBody, {
      status: expectedRequest.status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  });
});

afterEach((): void => {
  vi.restoreAllMocks();
  expect(pendingDiscordRequests, 'all mocked Discord requests should be consumed').toHaveLength(0);
});

describe('activity configuration', () => {
  it('returns the configured Discord client id', async (): Promise<void> => {
    const response = activityConfig(SESSION_ENVIRONMENT);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      clientId: 'test-client-id',
    });
  });

  it('reports missing Discord credentials', async (): Promise<void> => {
    await expectFailure(activityConfig({}), 500, 'MissingDiscordCredentials');
  });
});

describe('session creation', () => {
  it('rejects a malformed JSON body without calling Discord', async (): Promise<void> => {
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest('{')), 400, 'MissingCode');
  });

  it('rejects a body with no authorization code without calling Discord', async (): Promise<void> => {
    const body = JSON.stringify({
      instanceId: INSTANCE_ID,
    });
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest(body)), 400, 'MissingCode');
  });

  it('rejects a missing Discord client id without calling Discord', async (): Promise<void> => {
    await expectFailure(
      await createSession(
        {
          ...SESSION_ENVIRONMENT,
          DISCORD_CLIENT_ID: undefined,
        },
        sessionRequest(),
      ),
      500,
      'MissingDiscordCredentials',
    );
  });

  it('rejects a missing Discord client secret without calling Discord', async (): Promise<void> => {
    await expectFailure(
      await createSession(
        {
          ...SESSION_ENVIRONMENT,
          DISCORD_CLIENT_SECRET: undefined,
        },
        sessionRequest(),
      ),
      500,
      'MissingDiscordCredentials',
    );
  });

  it('rejects a missing bot token without calling Discord', async (): Promise<void> => {
    await expectFailure(
      await createSession(
        {
          ...SESSION_ENVIRONMENT,
          DISCORD_BOT_TOKEN: undefined,
        },
        sessionRequest(),
      ),
      500,
      'MissingIdentityCredentials',
    );
  });

  it('rejects a missing session secret without calling Discord', async (): Promise<void> => {
    await expectFailure(
      await createSession(
        {
          ...SESSION_ENVIRONMENT,
          SESSION_HMAC_SECRET: undefined,
        },
        sessionRequest(),
      ),
      500,
      'MissingIdentityCredentials',
    );
  });

  it('reports Discord OAuth rejection details from a parseable body', async (): Promise<void> => {
    expectDiscordRequests(exchangeRequest(JSON.stringify({ error: 'invalid_grant' }), 400));
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'TokenExchangeRejected', 'invalid_grant');
  });

  it('reports the status for a Discord OAuth rejection with an unparseable body', async (): Promise<void> => {
    expectDiscordRequests(exchangeRequest('not json', 429));
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'TokenExchangeRejected', 'discord returned 429');
  });

  it('rejects a malformed token exchange response', async (): Promise<void> => {
    expectDiscordRequests(exchangeRequest('not json'));
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'TokenExchangeMalformed');
  });

  it('rejects a failed user lookup', async (): Promise<void> => {
    expectDiscordRequests(exchangeRequest(JSON.stringify({ access_token: ACCESS_TOKEN })), userRequest('{}', 401));
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'UserLookupRejected', 'discord returned 401');
  });

  it('rejects a malformed user lookup response', async (): Promise<void> => {
    expectDiscordRequests(exchangeRequest(JSON.stringify({ access_token: ACCESS_TOKEN })), userRequest('not json'));
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'UserLookupMalformed');
  });

  it('rejects a failed activity-instance lookup', async (): Promise<void> => {
    expectDiscordRequests(
      exchangeRequest(JSON.stringify({ access_token: ACCESS_TOKEN })),
      userRequest(JSON.stringify({ id: 'player-1', username: 'discord-username' })),
      instanceRequest('{}', 503),
    );
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'InstanceLookupRejected', 'discord returned 503');
  });

  it('rejects a malformed activity-instance response', async (): Promise<void> => {
    expectDiscordRequests(
      exchangeRequest(JSON.stringify({ access_token: ACCESS_TOKEN })),
      userRequest(JSON.stringify({ id: 'player-1', username: 'discord-username' })),
      instanceRequest('not json'),
    );
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 502, 'InstanceLookupMalformed');
  });

  it('rejects a user who is not in the activity instance', async (): Promise<void> => {
    expectDiscordRequests(
      exchangeRequest(JSON.stringify({ access_token: ACCESS_TOKEN })),
      userRequest(JSON.stringify({ id: 'player-1', username: 'discord-username' })),
      instanceRequest(JSON.stringify({ users: ['player-2'] })),
    );
    await expectFailure(await createSession(SESSION_ENVIRONMENT, sessionRequest()), 403, 'NotInInstance');
  });

  it('uses the Discord global name when present', async (): Promise<void> => {
    await expectSuccessfulSession('Global Name', 'Global Name');
  });

  it('falls back to the Discord username when the global name is absent', async (): Promise<void> => {
    await expectSuccessfulSession(undefined, 'discord-username');
  });
});
