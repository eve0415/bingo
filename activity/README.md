# Bingo as a Discord Activity

An example client for the bingo room server: a party game for a Discord voice call, running as an Activity in the iframe Discord gives it.

One person in the call starts it and becomes the host; everyone else joins from the same call and gets a card. The host draws, the room daubs, and the strike bar through a completed line is the celebration. The interface is Japanese, the room is the voice channel everyone is already in, and there is no room code to read out. `DESIGN.md` is the design thesis and the authority on anything visual.

This package is also the worked implementation of the room server's integration contract, described in `../wrapper/README.md`. Everything Discord-specific lives here; nothing downstream of it knows Discord exists.

## How Discord maps onto a room

| Room server concept | What this client supplies                                               |
| ------------------- | ----------------------------------------------------------------------- |
| Room id             | The Discord activity instance id — one room per launch of the Activity. |
| `player.issuer`     | The literal `discord`.                                                  |
| `player.subject`    | The Discord user id.                                                    |
| `displayName`       | The Discord global name, or the username when there is none.            |

The name goes no further than the roster row it is stored in; the room server never reads it back, and no projection carries it. Avatars never leave this worker at all, and neither do the nicknames the roster actually shows — both are resolved here from Discord's record of the instance, which is also why they can differ from one server to the next.

## The handshake

1. The client fetches `/api/config` for the OAuth client id, then constructs the embedded SDK.
2. It calls `authorize` with the `identify` and `rpc.activities.write` scopes, falling back to `identify` alone if the second is refused.
3. It posts the resulting code to `/api/token`. The server exchanges it with Discord, reads the user, and then confirms with the bot token that this user really is a participant of the instance they claim — an OAuth code alone proves who someone is, not which room they are in.
4. Only then does the server mint the client's own room token: HMAC-SHA256, six hours, scoped to that instance id.

From there the room token is what every request to `/rooms/:id/*` carries. The route middleware verifies it, checks its `room` claim against the room in the URL, strips whatever identity header the browser sent, writes `x-bingo-verified-identity` itself, and forwards over the `WRAPPER` service binding. The browser never talks to the room server; it opens its WebSocket against this worker's own origin and the upgrade is proxied through the same path.

## Routes

| Route          | Purpose                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `/`            | The game. Runs the handshake, then the room screen for a player or a host.       |
| `/preview`     | The room screens rendered from fixtures, for working on the interface.           |
| `/api/config`  | The OAuth client id, so it is not baked into the bundle.                         |
| `/api/token`   | The code exchange, participant check and room-token mint described above.        |
| `/api/avatars` | Per-server avatars for the instance's participants, resolved with the bot token. |
| `/rooms/:id/*` | Everything under a room, verified here and proxied to the room server.           |
| `/health`      | Unauthenticated on purpose: it reports whether the binding is reachable.         |

## What the lobby exposes

The host sets the board at 3, 5, 7 or 9 across, chooses whether daubing is automatic or by hand, sets how many wins end the game, and decides how much of the draw the room gets to see. The engine and the room server accept more than that — custom win patterns, cards per player, late-join policy, claim-based wins — and `../wrapper/README.md` documents the full space. This client offers the four a party host actually changes.

## Configuration

Copy the example and fill in all four values.

```sh
cp .dev.vars.example .dev.vars
```

| Variable                | Used for                                                      |
| ----------------------- | ------------------------------------------------------------- |
| `DISCORD_CLIENT_ID`     | The OAuth client id, also served publicly from `/api/config`. |
| `DISCORD_CLIENT_SECRET` | The server-side half of the code exchange.                    |
| `DISCORD_BOT_TOKEN`     | Reading instance participants and their per-server avatars.   |
| `SESSION_HMAC_SECRET`   | Signing and verifying room tokens.                            |

A handler whose credential is missing returns an explicit failure rather than degrading. In production these are set with `wrangler secret put` against `bingo-activity` rather than from `.dev.vars`.

## Running it

```sh
pnpm dev
```

That one server is the whole stack: the Cloudflare Vite plugin builds and serves the room server alongside it as an auxiliary worker, so the service binding is live locally rather than stubbed.

To work on the interface without Discord, open `/preview`, which renders the room screens from fixtures and sends nothing anywhere. It is a development route and compiles to an empty shell in a production build.

## Testing

```sh
pnpm test
pnpm test:coverage
```

Tests run inside `workerd` through `@cloudflare/vitest-pool-workers`, against the same `wrangler.json` this worker deploys with, so the service binding and the request headers behave as they do in production. Coverage requires 100% of statements, branches, functions and lines across this package's TypeScript modules under `app`, plus `app/room/call.tsx`. The other React components and the Discord SDK glue sit outside the measured set, because a browser is the only place they run for real.

## Deploying

The room server has to exist first, because this worker's service binding names it.

```sh
pnpm -C ../wrapper deploy
pnpm deploy
```

In the Discord Developer Portal, point the Activity's URL mapping at the deployed worker. The scopes the handshake asks for are `identify` and `rpc.activities.write`.
