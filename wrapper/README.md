# Bingo room server

The Worker that runs games. One Durable Object per room, holding the event log, driving the WebAssembly engine, and broadcasting the result to whoever is connected.

It does not know what your product is. It has no notion of a lobby page, a friend list, a voice call or a login; it takes a room name, a player identity and a stream of commands, and it answers with projections of the game. `../activity/README.md` is one client built on this contract, against Discord.

## Before anything: it has no public hostname

`wrangler.json` sets `workers_dev: false` and `preview_urls: false` and declares no route and no custom domain. The room server is reachable only over a Cloudflare service binding, from a Worker you deploy yourself.

That is not incidental — it is the authentication. The room server trusts the identity it is handed, verbatim, so the private binding is the only thing standing between a player and anyone's claim to be them. There is no CORS handling here and there is nothing to add it to. **Adding CORS and calling this from a browser is not an available architecture**; every client needs a front-end Worker of its own.

```jsonc
// your-client/wrangler.json
"services": [{ "binding": "WRAPPER", "service": "bingo" }]
```

What that front end owes the room server is one header, and what it owes your users is everything else: signing them in, deciding what a room is in your product, and knowing their names.

## Routes

Four routes, all `GET`. Anything else falls through to a plain 404.

| Route                             | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `/health`                         | `{"ok":true}`. The only route needing no identity.        |
| `/rooms/:id/ws`                   | The WebSocket upgrade, and the only way to create a room. |
| `/rooms/:id/state`                | One snapshot, for a client that only wants to look.       |
| `/rooms/:id/games/:gameIndex/log` | A finished game's event log, for verifying it.            |

A room id must match `/^[A-Za-z0-9_-]{1,128}$/`, and a game index must be a non-negative integer with no leading zeros and at most ten digits.

Errors are always `{"error": "<Code>"}`.

| Code               | Status | Cause                                                                     |
| ------------------ | ------ | ------------------------------------------------------------------------- |
| `InvalidGameIndex` | 400    | The log route's index fails the pattern. Checked before everything else.  |
| `UpgradeRequired`  | 426    | `/ws` without an `Upgrade: websocket` header.                             |
| `InvalidRoomId`    | 400    | The room id fails the pattern.                                            |
| `MissingIdentity`  | 401    | No identity header.                                                       |
| `InvalidIdentity`  | 401    | An identity header that is not the shape below.                           |
| `JoinRejected`     | 409    | The connecting player was kicked out of this room. See below.             |
| `RoomNotFound`     | 404    | `/state` or `/log` on a room no socket has ever opened.                   |
| `NotMember`        | 403    | The caller is not on the roster.                                          |
| `GameNotFound`     | 404    | No game at that index.                                                    |
| `GameNotFinished`  | 409    | The log is readable only once the game is finished and the seed revealed. |
| `GameNotStarted`   | 409    | The game has no commitment because it never started.                      |

A rejected join is an HTTP 409 on the upgrade rather than a close frame on an opened socket, and being kicked is the only thing it means. A response carrying a status carries no socket to explain itself on, so a browser sees only a failed handshake: a front end that wants to tell a kicked player why has the 409 and has to say it itself. Being kicked _while connected_ is the case that does arrive as a close, code 1008 and the reason `Kicked`.

The other `JoinRejected` a client has to handle is not a refused connection at all. A `Join` command from a socket the room has already accepted is answered with an error frame of that code when the roster is at `maxPlayers`, which is what a watcher waiting for a seat will see.

## Watching

Everybody else is let in, seated or not. A connection the game cannot deal a card to — the roster is at `maxPlayers`, the game is running and late joining is closed, the game has finished and nobody has started another — opens anyway and is given the room to watch.

A watcher is sent **the host's projection**: every participant's card rather than an empty hand, because in bingo the cards are what there is to watch. `drawnVisibility` applies to them exactly as it applies to the host, so a room that does not want its progress public restricts it for both at once. Short of that, a watcher sees more than a seated player does — every card face and every daub — which is worth knowing before opening a room to people you would not hand the host's screen to.

Nothing in the protocol names a watcher. They are simply absent from `view.players`, and a client decides what to draw by looking for itself there.

A watcher is deliberately left off the roster, which has three consequences. They take up none of the `maxPlayers` places. `/state` and `/log` answer them `NotMember`, those being routes for the room's members. And the next game is dealt to the roster, so nothing seats a watcher automatically: they take a seat by sending `Join` once a game will accept one.

## Identity

The header is `x-bingo-verified-identity`, and its value is JSON:

```json
{ "player": { "issuer": "web", "subject": "u_1042" }, "displayName": "Aki" }
```

Each of the three strings is 1 to 256 characters. The bound is not cosmetic — the identity is serialized onto the socket so it survives hibernation, and an unbounded name would fail the upgrade rather than the request.

`issuer` is a namespace and nothing more. Nothing in the room server ever tests it for a particular value; it is compared, concatenated into a key, and stored as half of a primary key. Two players with the same `subject` under different issuers are two different people. Pick a string that names your provider and keep it stable, because it is half of every player's identity and it is one of the inputs to the game's commitment.

`displayName` is write-only. It is stored and never read back — no projection, no room info and no event carries it, so a client cannot learn another player's name from the room server. Names and pictures belong to your front end.

Three things follow for whoever writes that front end.

- **The header is a statement, not a proof.** It is JSON-parsed and shape-checked, and that is all. Whatever your proxy writes there is who the caller is.
- **Your own credentials do not pass through.** The room server strips `Authorization`, `Sec-WebSocket-Protocol` and all five `x-bingo-*` headers from an inbound request before setting its own, so a caller can neither smuggle an identity nor forward a bearer token. The identity header is the only channel.
- **One socket carries exactly one player.** The actor is read off the connection, not off each message. A bot fronting several people needs a socket each.

## The WebSocket session

### What arrives

Opening a socket joins the room. There is no join message to send.

- If the connection produced no events — a returning player, the host creating the room, or a watcher the game could not seat — that socket receives one `snapshot`.
- If it produced a `Join`, every connected socket receives a `snapshot` followed by an `events` frame, the new one included.

Every later state change follows the same pair: the authoritative snapshot first, then the events that explain it. A client never has to fold events into state. Treat `events` as a notification feed for animation and sound, and `snapshot` as the truth.

### What you send

```ts
{
  type: 'command';
  command: CommandDto;
} // a game command, below
{
  type: 'newGame';
  config: ConfigDto | null;
} // host only; null reuses the last config
{
  type: 'settings';
  settings: Partial<RoomSettings>;
} // host only
{
  type: 'resync';
} // send me a snapshot
```

```ts
{ type: 'snapshot'; view: RoomView; room: RoomInfo; drawnOrder: number[] }
{ type: 'events';   events: EventDto[]; drawnOrder: number[] }
{ type: 'error';    code: string; detail: string | null }
```

The player and host projections are the same shape and differ only in content: a player's carries their own cards, a host's carries everyone's. One validator handles both.

`RoomInfo` is a pair of states rather than a bag of optionals. Before the first `Start`, `commitment`, `commitmentConfig` and `commitmentRoster` are all `null`; afterwards all three are set.

### Commands and who may issue them

Host-only commands are rejected with `NotHost` before any other check, so a non-host never learns the phase from an error.

| Command          | Who    | Phases         | Notable rejections                                                                                                                  |
| ---------------- | ------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Join`           | anyone | Lobby, Running | `Kicked`, `AlreadyJoined`, `RoomLocked` when late join is closed                                                                    |
| `Leave`          | anyone | Lobby, Running | `NotAParticipant`                                                                                                                   |
| `Mark`, `Unmark` | anyone | Running        | `ManualDaubDisabled`, `UnknownCard`, `NoSuchPosition`, `NumberNotOnCard`, `NumberNotDrawn`; `BacklogMarkNotAllowed` on `Mark` alone |
| `Claim`          | anyone | Running        | `ClaimDisabled`, `UnknownCard`, `NoBingo`, `WinAlreadyRecognised`                                                                   |
| `Start`          | host   | Lobby          | `WrongPhase`, which is also what an empty participant list returns                                                                  |
| `Draw`           | host   | Running        | `NoNumbersRemain`                                                                                                                   |
| `Undo`           | host   | Running        | `NothingToUndo`, `WinAlreadyRecognised`                                                                                             |
| `Close`          | host   | Lobby, Running | `WrongPhase` if the game is already finished                                                                                        |
| `Kick`           | host   | Lobby, Running | `NotAParticipant`; a player who already left is still kickable                                                                      |
| `TransferHost`   | host   | Lobby, Running | `NotAParticipant`; the target has to be active                                                                                      |

One trap: a caller who is not in the game gets `UnknownCard` from `Mark`, `Unmark` and `Claim`, not `NotAParticipant`.

A second one: `RoomLocked` is about somebody who has never been seated in this game. A player who issued `Leave` is not late joining when they come back — the engine still holds their cards, their marks and the draw they joined at, and hands all three back as they were — so a return is accepted mid-game whatever `lateJoin` says. The one thing it does not restore is a rank: a line that completed while they were away is recognised when they return, behind anyone recognised in the meantime.

The host is whoever opened the first socket to a room that did not exist. The role is about being in the room rather than playing in it: a host who gives up a seat goes on calling numbers, and the room moves on only when the host is kicked out of it or when no socket has belonged to them for 30 seconds. Either of those closes the game or hands the role on, depending on `hostAutoClose`, and a client will see a `HostTransferred` or `GameClosed` event it did not ask for. Where the successor is a watcher the role moves without a `HostTransferred`, because a game keeps the host it was played under and only a player in that game can be it. A kicked player's sockets are closed with code 1008 and the reason `Kicked`.

### Rate limit

120 messages per 10 seconds per socket. Exceeding it returns `RateLimited` and leaves the socket open. The check runs before parsing, so malformed frames spend the budget too.

### Reconnecting

Send `resync` and you get a snapshot on that socket alone. There is no event replay and no cursor to resume from, because there is nothing to resume: reconnect, take the snapshot as truth, and carry on. Reconnecting runs the join path again, which is harmless for a player already on the roster and leaves whoever the game will not seat watching it.

### Draw order

`drawnOrder` on every frame is the chronological sequence of numbers called. `view.drawn` is the same set in ascending numeric order, which is what a flashboard wants and is silently wrong for anything that cares about what was called last.

Both are redacted while the game runs, according to the room's `drawnVisibility`: `Full` shows everything, `LatestOnly` shows only the most recent number, `Hidden` shows none. Under a restriction, other players' progress is blanked and draw events are filtered out of the `events` frame entirely, so a client cannot reconstruct what it was not told.

### Subprotocol

Whatever a client offers as the first `Sec-WebSocket-Protocol` value is echoed back on the upgrade, unexamined. The room server attaches no meaning to it. It exists because a browser cannot set headers on a `WebSocket`, so a front end that carries a session token in the subprotocol needs something echoed or the browser refuses the connection. Use it that way or ignore it.

## Rooms expire

A room exists from the first socket. `/state` and `/log` return `RoomNotFound` before that — there is no way to create a room over HTTP.

| Horizon         | After | Effect                                                                                      |
| --------------- | ----- | ------------------------------------------------------------------------------------------- |
| Host absent     | 30 s  | No socket belongs to the host. Transfer the role, or close the game if `hostAutoClose`.     |
| Room empty      | 5 min | Nobody holds a seat, however many are watching. Close the current game; nothing is deleted. |
| Room vacant     | 5 min | No socket at all. **Delete the room and everything in it.**                                 |
| Reveal backstop | 24 h  | Close the game so its seed is revealed and it can be verified.                              |
| Garbage collect | 7 d   | Delete a room nobody has touched.                                                           |

None of these are configurable over the wire.

**The five-minute wipe is the sharpest constraint on a client with stable room names.** Five minutes with no connected socket removes the roster, the kick list, the host, the settings, and every past game's log and commitment; the next person to connect finds an empty room and becomes its host. Where a room name is ephemeral — a fresh identifier per session, which is what the Discord client gets — this is invisible and correct. Where a room is something like `/rooms/friday-night`, a lull in the conversation silently resets it. If your product needs a room to outlive its players, the room name has to be minted per session, or the state you care about has to live on your side.

## More than one game

`newGame` closes the current game if it is running, creates the next one, and broadcasts it. The room's settings, its host and its roster carry over; the seed and the commitment are new, and the kick list is always cleared, so a player kicked from one game can join the next.

Set `rosterPersistence` to `ClearBetweenGames` to drop the roster instead, which leaves the host on it and everybody else off, and pass `config: null` to reuse the previous game's configuration. Because closing a lobby is legal, `newGame` works from a room that never started as well as from a finished one.

Past games keep their config, seed, commitment, starting roster and full event log for the life of the room, and each becomes readable at `/rooms/:id/games/:n/log` once it is finished.

## What a client can reuse

Both packages are private and export raw TypeScript, so a client inside this repository imports them directly and one outside it vendors the files.

| Import                      | Contents                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `@bingo/wrapper/identity`   | The header names, the identity schema, `encodeIdentity`, `samePlayer`, `playerKey`. What a proxy needs. |
| `@bingo/wrapper/protocol`   | The config and command schemas, and the `RoomView`, `RoomInfo`, `ClientMessage`, `ServerMessage` types. |
| `@bingo/wrapper/settings`   | The room settings schema, `DEFAULT_SETTINGS`, `MAX_PLAYERS` and the deadline horizons.                  |
| `@bingo/wasm/PlayerViewDto` | Any of the engine's generated DTOs, one module each.                                                    |
| `@bingo/wasm/glue`          | The engine itself, if you want to run it client-side.                                                   |

`protocol` gives you types for server messages but no validator for them; validating what arrives on the socket is the client's job.

### Verifying a finished game

The engine is small enough to ship to the client, which means a player can check the host's honesty without trusting anyone. Read a finished game's log, and re-run `replay` and `commitment` from `@bingo/wasm/glue` against the revealed seed. If the log replays to the same events and the commitment matches the one published when the game started, the deal was fixed before the first number was called.

One thing to get right: hash `room.commitmentConfig`, not `view.config`. The commitment covers the configuration as it was submitted, before the engine expands an empty pattern list into the default rows, columns and diagonals — so the config in the view carries a pattern per row, per column and per diagonal where the committed one carries none, and hashing the wrong one always fails.

## Nothing here knows about Discord

The room server branches on no issuer, parses no id format, and calls no third party. Its test suite runs mostly on issuers named `hmac`, `second`, `guest` and `test`, because the value is arbitrary and the tests are about the pair, not the provider. Discord is named exactly once in the source, in a comment explaining why the room-expiry horizons are safe under ephemeral room names — which is the one place an assumption from the first client shows through, and the reason the section above spells out what happens when your room names are not ephemeral.

## Developing

```sh
pnpm dev            # or run a client's dev server, which serves this one alongside it
pnpm test
pnpm test:coverage
pnpm run deploy     # `run` because pnpm's own deploy command shadows the script
```

Tests run inside `workerd` through `@cloudflare/vitest-pool-workers`, against this package's own `wrangler.json`, so the Durable Object and its SQLite storage behave as they do in production. Coverage requires 100% of statements, branches, functions and lines across `src`.

This Worker needs no secrets and no environment variables of its own.
