import type { EngineResult } from './engine';
import type { VerifiedIdentity } from './identity';
import type { ClientMessage, GameLogResponse, RoomInfo, ServerMessage } from './protocol';
import type { RoomSettings } from './settings';
import type { BridgeErrorDto } from '@bingo/wasm/BridgeErrorDto';
import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { HostViewDto } from '@bingo/wasm/HostViewDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { PlayerViewDto } from '@bingo/wasm/PlayerViewDto';
import type { Snapshot } from '@bingo/wasm/Snapshot';

import { DurableObject } from 'cloudflare:workers';
import { is, safeParse } from 'valibot';

import { applyCommand, createCommitment, eventKind, eventSequence, initialize, projectHost, projectPlayer, rebuild } from './engine';
import {
  GAME_INDEX_HEADER,
  ROOM_KEY_HEADER,
  ROOM_MODE_HEADER,
  SELECTED_PROTOCOL_HEADER,
  VERIFIED_IDENTITY_HEADER,
  decodeIdentity,
  parseJson,
  playerKey,
  samePlayer,
  verifiedIdentitySchema,
} from './identity';
import { clientMessageEnvelopeSchema, commandSchema, configSchema } from './protocol';
import { DEADLINE_HORIZONS, DEFAULT_SETTINGS } from './settings';

type GameRowBase = {
  game_ix: number;
  config: string;
  seed: string;
  phase: string;
};
type GameRow = GameRowBase &
  (
    | {
        commitment: null;
        roster: null;
      }
    | {
        commitment: string;
        roster: string;
      }
  );
type SnapshotRow = {
  blob: string;
};
type EventRow = {
  payload: string;
};
type GameCacheRow = {
  blob: string;
};
type SettingRow = {
  v: string;
};
type CountRow = {
  count: number;
};
type DeadlineRow = {
  kind: string;
  at: number;
};
interface GameCache {
  drawnOrder: number[];
  activePlayers: PlayerIdDto[];
}
interface PreparedGame {
  seed: string;
  state: Snapshot;
}
interface MessageRate {
  startedAt: number;
  count: number;
}
const CURRENT_GAME = 'current_game';
const ROOM_ID = 'room_id';
const HOST = 'host';
const ROOM_SETTINGS = 'room_settings';
const INITIAL_HOST_PREFIX = 'initial_host:';
const DEFAULT_CONFIG: ConfigDto = {
  size: 5,
  freeCenter: true,
  patterns: [],
  daub: 'Auto',
  winDetection: 'Auto',
  lateJoin: 'Closed',
  winLimit: 'FirstOnly',
  cardsPerPlayer: 1,
};
const isVerifiedIdentity = (value: unknown): value is VerifiedIdentity => is(verifiedIdentitySchema, value);
const errorJson = (error: string, status: number): Response => Response.json({ error }, { status });
const decodeStored = <T>(value: string): T => JSON.parse(value);
const requireEngine = <T>(result: EngineResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};
const engineError = (
  error: BridgeErrorDto,
): {
  code: string;
  detail: string | null;
} => {
  if (error.type === 'rule' || error.type === 'config') {
    return {
      code: error.code,
      detail: null,
    };
  }
  return {
    code: {
      input: 'InvalidInput',
      state: 'InvalidState',
    }[error.type],
    detail: error.message,
  };
};
const eventPlayerJoined = (event: EventDto): PlayerIdDto | null => ('PlayerJoined' in event ? event.PlayerJoined.player : null);
const eventPlayerRemoved = (event: EventDto): PlayerIdDto | null => {
  if ('PlayerLeft' in event) return event.PlayerLeft.player;
  return 'PlayerKicked' in event ? event.PlayerKicked.target : null;
};
const eventNewHost = (event: EventDto): PlayerIdDto | null => ('HostTransferred' in event ? event.HostTransferred.target : null);
const isDrawEvent = (event: EventDto): boolean => 'NumberDrawn' in event || 'DrawUndone' in event;
const markEventPlayer = (event: EventDto): PlayerIdDto | null => {
  if ('MarkPlaced' in event) return event.MarkPlaced.player;
  return 'MarkRemoved' in event ? event.MarkRemoved.player : null;
};
const updateGameCache = (cache: GameCache, events: EventDto[]): GameCache => {
  const drawnOrder = [...cache.drawnOrder];
  const activePlayers = new Map(cache.activePlayers.map(player => [playerKey(player), player]));
  for (const event of events) {
    const joined = eventPlayerJoined(event);
    if (joined !== null) activePlayers.set(playerKey(joined), joined);
    const removed = eventPlayerRemoved(event);
    if (removed !== null) activePlayers.delete(playerKey(removed));
    if ('NumberDrawn' in event) drawnOrder.push(event.NumberDrawn.number);
    if ('DrawUndone' in event) drawnOrder.pop();
  }
  return {
    drawnOrder,
    activePlayers: [...activePlayers.values()],
  };
};
type MessageParseResult =
  | {
      ok: true;
      value: ClientMessage;
    }
  | {
      ok: false;
      code: 'MalformedMessage' | 'InvalidInput';
    };
const parseMessage = (value: string | ArrayBuffer): MessageParseResult => {
  if (typeof value !== 'string') return { ok: false, code: 'MalformedMessage' };
  const envelope = safeParse(clientMessageEnvelopeSchema, parseJson(value));
  if (!envelope.success) return { ok: false, code: 'MalformedMessage' };
  if (envelope.output.type === 'command') {
    const command = safeParse(commandSchema, envelope.output.command);
    return command.success
      ? {
          ok: true,
          value: {
            type: 'command',
            command: command.output,
          },
        }
      : { ok: false, code: 'InvalidInput' };
  }
  if (envelope.output.type === 'newGame') {
    if (envelope.output.config === null) {
      return {
        ok: true,
        value: {
          type: 'newGame',
          config: null,
        },
      };
    }
    const config = safeParse(configSchema, envelope.output.config);
    return config.success
      ? {
          ok: true,
          value: {
            type: 'newGame',
            config: config.output,
          },
        }
      : { ok: false, code: 'InvalidInput' };
  }
  return {
    ok: true,
    value: envelope.output,
  };
};
const newest = (values: number[]): number[] => {
  const value = values.at(-1);
  return value === undefined ? [] : [value];
};
const redactView = <T extends PlayerViewDto | HostViewDto>(view: T, settings: RoomSettings, order: number[], recipient: PlayerIdDto): T => {
  if (view.phase !== 'Running' || settings.drawnVisibility === 'Full') return view;
  return {
    ...view,
    drawn: settings.drawnVisibility === 'LatestOnly' ? newest(order) : [],
    wins: view.wins.map(win =>
      win.winners.every(winner => samePlayer(winner, recipient))
        ? win
        : {
            ...win,
            patterns: [],
          },
    ),
    cards: view.cards.map(card => {
      // Players always retain their own daubs; restricted visibility conceals the called-numbers board and other players' marks, not their physical card.
      if (samePlayer(card.owner, recipient)) return card;
      return {
        ...card,
        marked: [],
        bingo: [],
        reach: [],
      };
    }),
  };
};
const redactOrder = (values: number[], settings: RoomSettings, phase: PlayerViewDto['phase']): number[] => {
  if (phase !== 'Running' || settings.drawnVisibility === 'Full') return values;
  return settings.drawnVisibility === 'LatestOnly' ? newest(values) : [];
};
const redactEvents = (events: EventDto[], settings: RoomSettings, phase: PlayerViewDto['phase'], recipient: PlayerIdDto): EventDto[] => {
  if (phase !== 'Running' || settings.drawnVisibility === 'Full') return events;
  return events.filter(event => {
    if (isDrawEvent(event)) return false;
    const player = markEventPlayer(event);
    return player === null || samePlayer(player, recipient);
  });
};
export class Room extends DurableObject<Env> {
  // Hibernation may reset this per-socket limiter; unlike game state, that is harmless and avoids a storage write for every message.
  private readonly messageRates = new WeakMap<WebSocket, MessageRate>();
  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.createSchema();
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private createSchema(): void {
    const { sql } = this.ctx.storage;
    sql.exec('CREATE TABLE IF NOT EXISTS games (game_ix INTEGER PRIMARY KEY, config BLOB, commitment BLOB, roster BLOB, seed BLOB, phase TEXT)');
    sql.exec('CREATE TABLE IF NOT EXISTS events (game_ix INTEGER, seq INTEGER, kind TEXT, payload BLOB, PRIMARY KEY (game_ix, seq))');
    sql.exec('CREATE TABLE IF NOT EXISTS snapshot (game_ix INTEGER PRIMARY KEY, at_seq INTEGER, blob BLOB)');
    sql.exec('CREATE TABLE IF NOT EXISTS game_cache (game_ix INTEGER PRIMARY KEY, blob BLOB)');
    sql.exec('CREATE TABLE IF NOT EXISTS roster (issuer TEXT, subject TEXT, display_name TEXT, joined_at INTEGER, PRIMARY KEY (issuer, subject))');
    sql.exec('CREATE TABLE IF NOT EXISTS kicks (issuer TEXT, subject TEXT, PRIMARY KEY (issuer, subject))');
    sql.exec('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v BLOB)');
    sql.exec('CREATE TABLE IF NOT EXISTS deadlines (kind TEXT PRIMARY KEY, at INTEGER)');
  }
  private one<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): T | null {
    const row = this.ctx.storage.sql
      .exec<T>(query, ...bindings)
      .toArray()
      .at(0);
    return row ?? null;
  }
  private setting<T>(key: string): T {
    const row = this.one<SettingRow>('SELECT v FROM settings WHERE k = ?', key);
    if (row === null) throw new Error(`missing setting: ${key}`);
    return decodeStored<T>(row.v);
  }
  private optionalSetting<T>(key: string): T | null {
    const row = this.one<SettingRow>('SELECT v FROM settings WHERE k = ?', key);
    return row === null ? null : decodeStored<T>(row.v);
  }
  private writeSetting(key: string, value: unknown): void {
    this.ctx.storage.sql.exec('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value));
  }
  private game(): GameRow {
    const gameIndex = this.setting<number>(CURRENT_GAME);
    const row = this.gameAt(gameIndex);
    if (row === null) throw new Error('current game is missing');
    return row;
  }
  private gameAt(gameIndex: number): GameRow | null {
    return this.one<GameRow>('SELECT game_ix, config, commitment, roster, seed, phase FROM games WHERE game_ix = ?', gameIndex);
  }
  private events(gameIndex: number): EventDto[] {
    return this.ctx.storage.sql
      .exec<EventRow>('SELECT payload FROM events WHERE game_ix = ? ORDER BY seq', gameIndex)
      .toArray()
      .map(row => decodeStored<EventDto>(row.payload));
  }
  private gameCache(gameIndex: number): GameCache {
    const cached = this.one<GameCacheRow>('SELECT blob FROM game_cache WHERE game_ix = ?', gameIndex);
    if (cached !== null) return decodeStored<GameCache>(cached.blob);
    const rebuilt = updateGameCache(
      {
        drawnOrder: [],
        activePlayers: [],
      },
      this.events(gameIndex),
    );
    this.writeGameCache(gameIndex, rebuilt);
    return rebuilt;
  }
  private writeGameCache(gameIndex: number, cache: GameCache): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO game_cache (game_ix, blob) VALUES (?, ?) ON CONFLICT(game_ix) DO UPDATE SET blob = excluded.blob',
      gameIndex,
      JSON.stringify(cache),
    );
  }
  private snapshot(game: GameRow): Snapshot {
    const cached = this.one<SnapshotRow>('SELECT blob FROM snapshot WHERE game_ix = ?', game.game_ix);
    if (cached !== null) return cached.blob;
    const initialHost = this.setting<PlayerIdDto>(`${INITIAL_HOST_PREFIX}${game.game_ix}`);
    const restored = requireEngine(
      rebuild({
        config: decodeStored<ConfigDto>(game.config),
        seed: game.seed,
        host: initialHost,
        log: this.events(game.game_ix),
      }),
    ).state;
    const last = this.ctx.storage.sql
      .exec<{
        seq: number;
      }>('SELECT COALESCE(MAX(seq), -1) AS seq FROM events WHERE game_ix = ?', game.game_ix)
      .one();
    this.ctx.storage.sql.exec('INSERT INTO snapshot (game_ix, at_seq, blob) VALUES (?, ?, ?)', game.game_ix, last.seq, restored);
    return restored;
  }
  private persist(game: GameRow, state: Snapshot, events: EventDto[], phase: string = game.phase): void {
    const cache = this.gameCache(game.game_ix);
    let atSequence = -1;
    for (const event of events) {
      atSequence = eventSequence(event);
      this.ctx.storage.sql.exec(
        'INSERT INTO events (game_ix, seq, kind, payload) VALUES (?, ?, ?, ?)',
        game.game_ix,
        atSequence,
        eventKind(event),
        JSON.stringify(event),
      );
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO snapshot (game_ix, at_seq, blob) VALUES (?, ?, ?) ON CONFLICT(game_ix) DO UPDATE SET at_seq = excluded.at_seq, blob = excluded.blob',
      game.game_ix,
      atSequence,
      state,
    );
    this.ctx.storage.sql.exec('UPDATE games SET phase = ? WHERE game_ix = ?', phase, game.game_ix);
    this.writeGameCache(game.game_ix, updateGameCache(cache, events));
  }
  private roster(): PlayerIdDto[] {
    return this.ctx.storage.sql
      .exec<{
        issuer: string;
        subject: string;
      }>('SELECT issuer, subject FROM roster ORDER BY joined_at, issuer, subject')
      .toArray()
      .map(row => ({
        issuer: row.issuer,
        subject: row.subject,
      }));
  }
  private rosterHas(player: PlayerIdDto): boolean {
    return this.one<CountRow>('SELECT COUNT(*) AS count FROM roster WHERE issuer = ? AND subject = ?', player.issuer, player.subject)?.count === 1;
  }
  private addRoster(identity: VerifiedIdentity): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO roster (issuer, subject, display_name, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(issuer, subject) DO UPDATE SET display_name = excluded.display_name',
      identity.player.issuer,
      identity.player.subject,
      identity.displayName,
      Date.now(),
    );
  }
  private removeRoster(player: PlayerIdDto): void {
    this.ctx.storage.sql.exec('DELETE FROM roster WHERE issuer = ? AND subject = ?', player.issuer, player.subject);
  }
  private isKicked(player: PlayerIdDto): boolean {
    return this.one<CountRow>('SELECT COUNT(*) AS count FROM kicks WHERE issuer = ? AND subject = ?', player.issuer, player.subject)?.count === 1;
  }
  private kickedPlayers(): Set<string> {
    return new Set(
      this.ctx.storage.sql
        .exec<{
          issuer: string;
          subject: string;
        }>('SELECT issuer, subject FROM kicks')
        .toArray()
        .map(player => playerKey(player)),
    );
  }
  private kick(player: PlayerIdDto): void {
    this.removeRoster(player);
    this.ctx.storage.sql.exec('INSERT OR IGNORE INTO kicks (issuer, subject) VALUES (?, ?)', player.issuer, player.subject);
    for (const socket of this.ctx.getWebSockets()) {
      const connected = Room.socketPlayer(socket);
      if (connected !== null && samePlayer(connected, player)) socket.close(1008, 'Kicked');
    }
  }
  private createRoom(roomId: string, identity: VerifiedIdentity): void {
    this.addRoster(identity);
    this.writeSetting(CURRENT_GAME, 0);
    this.writeSetting(ROOM_ID, roomId);
    this.writeSetting(HOST, identity.player);
    this.writeSetting(ROOM_SETTINGS, DEFAULT_SETTINGS);
    this.createGame(0, DEFAULT_CONFIG, identity.player, this.roster(), requireEngine(Room.prepareGame(DEFAULT_CONFIG, identity.player)));
    const now = Date.now();
    this.setDeadline('room_gc', now + DEADLINE_HORIZONS.roomGc);
    this.queueAlarm();
  }
  private static prepareGame(config: ConfigDto, host: PlayerIdDto): EngineResult<PreparedGame> {
    const seedBytes = crypto.getRandomValues(new Uint8Array(32));
    const seed = Array.from(seedBytes, value => value.toString(16).padStart(2, '0')).join('');
    const initialized = initialize({
      config,
      seed,
      host,
    });
    if (!initialized.ok) return initialized;
    return {
      ok: true,
      value: {
        seed,
        state: initialized.value.state,
      },
    };
  }
  private createGame(gameIndex: number, config: ConfigDto, host: PlayerIdDto, initialRoster: PlayerIdDto[], prepared: PreparedGame): void {
    let { state } = prepared;
    const allEvents: EventDto[] = [];
    for (const player of initialRoster) {
      const joined = requireEngine(applyCommand(state, player, 'Join'));
      ({ state } = joined);
      allEvents.push(...joined.events);
    }
    this.ctx.storage.sql.exec(
      'INSERT INTO games (game_ix, config, commitment, roster, seed, phase) VALUES (?, ?, ?, ?, ?, ?)',
      gameIndex,
      JSON.stringify(config),
      null,
      null,
      prepared.seed,
      'Lobby',
    );
    this.writeSetting(`${INITIAL_HOST_PREFIX}${gameIndex}`, host);
    const game: GameRow = {
      game_ix: gameIndex,
      config: JSON.stringify(config),
      commitment: null,
      roster: null,
      seed: prepared.seed,
      phase: 'Lobby',
    };
    this.persist(game, state, allEvents);
    this.setDeadline('reveal_backstop', Date.now() + DEADLINE_HORIZONS.revealBackstop);
  }
  private publishCommitment(game: GameRow, roster: PlayerIdDto[]): void {
    const { config, game_ix: gameIndex, seed } = game;
    const published = requireEngine(
      createCommitment({
        seed,
        config: decodeStored<ConfigDto>(config),
        roster,
        roomId: this.setting<string>(ROOM_ID),
        gameIndex,
      }),
    );
    const { commitment } = published;
    // This proves the seed and inputs were fixed before the first draw; it cannot prove the operator did not search candidate seeds first.
    this.ctx.storage.sql.exec('UPDATE games SET commitment = ?, roster = ? WHERE game_ix = ?', commitment, JSON.stringify(roster), gameIndex);
  }
  private roomInfo(game: GameRow): RoomInfo {
    const base = {
      settings: this.setting<RoomSettings>(ROOM_SETTINGS),
      roomId: this.setting<string>(ROOM_ID),
      gameIndex: game.game_ix,
      host: this.setting<PlayerIdDto>(HOST),
    };
    return game.commitment === null
      ? {
          ...base,
          commitment: null,
          commitmentConfig: null,
          commitmentRoster: null,
        }
      : {
          ...base,
          commitment: game.commitment,
          commitmentConfig: decodeStored<ConfigDto>(game.config),
          commitmentRoster: decodeStored<PlayerIdDto[]>(game.roster),
        };
  }
  private drawnOrder(gameIndex: number): number[] {
    return this.gameCache(gameIndex).drawnOrder;
  }
  private static send(socket: WebSocket, message: ServerMessage): void {
    socket.send(JSON.stringify(message));
  }
  private static sendEngineError(socket: WebSocket, failure: BridgeErrorDto): void {
    const { code, detail } = engineError(failure);
    Room.sendError(socket, code, detail);
  }
  private static sendError(socket: WebSocket, code: string, detail: string | null = null): void {
    Room.send(socket, {
      type: 'error',
      code,
      detail,
    });
  }
  private static socketPlayer(socket: WebSocket): PlayerIdDto | null {
    const attachment: unknown = socket.deserializeAttachment();
    return isVerifiedIdentity(attachment) ? attachment.player : null;
  }
  private static socketIdentity(socket: WebSocket): VerifiedIdentity | null {
    const attachment: unknown = socket.deserializeAttachment();
    return isVerifiedIdentity(attachment) ? attachment : null;
  }
  private static project(state: Snapshot, player: PlayerIdDto, host: PlayerIdDto): PlayerViewDto | HostViewDto {
    return samePlayer(player, host) ? requireEngine(projectHost(state)) : requireEngine(projectPlayer(state, player));
  }
  private snapshotMessage(state: Snapshot, game: GameRow, player: PlayerIdDto): ServerMessage {
    const info = this.roomInfo(game);
    const fullOrder = this.drawnOrder(game.game_ix);
    const view = redactView(Room.project(state, player, info.host), info.settings, fullOrder, player);
    return {
      type: 'snapshot',
      view,
      room: info,
      drawnOrder: redactOrder(fullOrder, info.settings, view.phase),
    };
  }
  private sendSnapshot(socket: WebSocket, player: PlayerIdDto): void {
    const game = this.game();
    Room.send(socket, this.snapshotMessage(this.snapshot(game), game, player));
  }
  private broadcast(events: EventDto[]): void {
    const game = this.game();
    const state = this.snapshot(game);
    const info = this.roomInfo(game);
    const fullOrder = this.drawnOrder(game.game_ix);
    const kicked = this.kickedPlayers();
    let revealed = false;
    for (const socket of this.ctx.getWebSockets()) {
      const player = socket.readyState === WebSocket.OPEN ? Room.socketPlayer(socket) : null;
      if (player !== null && !kicked.has(playerKey(player))) {
        const view = redactView(Room.project(state, player, info.host), info.settings, fullOrder, player);
        const order = redactOrder(fullOrder, info.settings, view.phase);
        revealed ||= view.revealedSeed !== null;
        Room.send(socket, {
          type: 'snapshot',
          view,
          room: info,
          drawnOrder: order,
        });
        Room.send(socket, {
          type: 'events',
          events: redactEvents(events, info.settings, view.phase, player),
          drawnOrder: order,
        });
      }
    }
    if (revealed) {
      if (game.phase !== 'Finished') {
        this.ctx.storage.sql.exec('UPDATE games SET phase = ? WHERE game_ix = ?', 'Finished', game.game_ix);
      }
      this.clearDeadline('reveal_backstop');
    }
  }
  private apply(
    game: GameRow,
    actor: PlayerIdDto,
    command: CommandDto,
    phase: string = game.phase,
  ): EngineResult<{
    state: Snapshot;
    events: EventDto[];
  }> {
    const result = applyCommand(this.snapshot(game), actor, command);
    if (!result.ok) return result;
    this.persist(game, result.value.state, result.value.events, phase);
    return {
      ok: true,
      value: result.value,
    };
  }
  private activePlayers(): Set<string> {
    return new Set(this.gameCache(this.setting<number>(CURRENT_GAME)).activePlayers.map(playerKey));
  }
  private presentPlayers(excluded?: WebSocket): PlayerIdDto[] {
    const active = this.activePlayers();
    const present = new Map<string, PlayerIdDto>();
    // Heartbeats are answered without waking this object, so presence is only an approximate snapshot taken while another event has it awake.
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== excluded) {
        const player = Room.socketPlayer(socket);
        if (player !== null && active.has(playerKey(player))) {
          present.set(playerKey(player), player);
        }
      }
    }
    return [...present.values()];
  }
  private static departingHost(events: EventDto[], host: PlayerIdDto): boolean {
    return events.some(event => {
      const removed = eventPlayerRemoved(event);
      return removed !== null && samePlayer(removed, host);
    });
  }
  private updateRoster(events: EventDto[], identity: VerifiedIdentity): void {
    for (const event of events) {
      const joined = eventPlayerJoined(event);
      if (joined !== null && samePlayer(joined, identity.player)) {
        this.addRoster(identity);
      }
      if ('PlayerKicked' in event) this.kick(event.PlayerKicked.target);
      const host = eventNewHost(event);
      if (host !== null) this.writeSetting(HOST, host);
    }
  }
  private transferDepartingHost(game: GameRow, events: EventDto[], oldHost: PlayerIdDto): EventDto[] {
    if (!Room.departingHost(events, oldHost)) return events;
    if (this.setting<RoomSettings>(ROOM_SETTINGS).hostAutoClose) {
      const closed = this.apply(game, oldHost, 'Close', 'Finished');
      if (!closed.ok) return events;
      this.clearDeadline('reveal_backstop');
      return [...events, ...closed.value.events];
    }
    const target = this.presentPlayers().at(0);
    if (target === undefined) {
      this.setDeadline('room_empty', Date.now() + DEADLINE_HORIZONS.roomEmpty);
      this.queueAlarm();
      return events;
    }
    const transfer = this.apply(game, oldHost, {
      TransferHost: {
        target,
      },
    });
    if (!transfer.ok) return events;
    this.writeSetting(HOST, target);
    return [...events, ...transfer.value.events];
  }
  private joinAllowed(player: PlayerIdDto): boolean {
    if (this.isKicked(player)) return false;
    if (this.activePlayers().has(playerKey(player))) return true;
    if (this.rosterHas(player)) return true;
    const { count } = this.ctx.storage.sql.exec<CountRow>('SELECT COUNT(*) AS count FROM roster').one();
    return count < this.setting<RoomSettings>(ROOM_SETTINGS).maxPlayers;
  }
  private handleCommand(socket: WebSocket, identity: VerifiedIdentity, command: CommandDto): void {
    const actor = identity.player;
    if (command === 'Join' && !this.joinAllowed(actor)) {
      Room.sendError(socket, 'JoinRejected');
      return;
    }
    const game = this.game();
    const oldHost = this.setting<PlayerIdDto>(HOST);
    const startRoster = command === 'Start' ? this.gameCache(game.game_ix).activePlayers : null;
    const startedPhase = command === 'Start' ? 'Running' : game.phase;
    const phase = command === 'Close' ? 'Finished' : startedPhase;
    const result = this.apply(game, actor, command, phase);
    if (!result.ok) {
      Room.sendEngineError(socket, result.error);
      return;
    }
    if (startRoster !== null) this.publishCommitment(game, startRoster);
    const events = this.transferDepartingHost(game, result.value.events, oldHost);
    this.updateRoster(events, identity);
    this.broadcast(events);
  }
  private handleNewGame(socket: WebSocket, identity: VerifiedIdentity, config: ConfigDto | null): void {
    const actor = identity.player;
    const host = this.setting<PlayerIdDto>(HOST);
    if (!samePlayer(actor, host)) {
      Room.sendError(socket, 'NotHost');
      return;
    }
    const current = this.game();
    const nextConfig = config ?? decodeStored<ConfigDto>(current.config);
    const prepared = Room.prepareGame(nextConfig, host);
    if (!prepared.ok) {
      Room.sendEngineError(socket, prepared.error);
      return;
    }
    if (current.phase !== 'Finished') {
      const closed = this.apply(current, host, 'Close', 'Finished');
      if (!closed.ok) {
        Room.sendEngineError(socket, closed.error);
        return;
      }
      this.broadcast(closed.value.events);
    }
    const settings = this.setting<RoomSettings>(ROOM_SETTINGS);
    if (settings.rosterPersistence === 'ClearBetweenGames') {
      this.ctx.storage.sql.exec('DELETE FROM roster');
      this.addRoster(identity);
    }
    this.ctx.storage.sql.exec('DELETE FROM kicks');
    const gameIndex = current.game_ix + 1;
    this.createGame(gameIndex, nextConfig, host, this.roster(), prepared.value);
    this.writeSetting(CURRENT_GAME, gameIndex);
    this.queueAlarm();
    this.broadcast([]);
  }
  private handleSettings(socket: WebSocket, actor: PlayerIdDto, changes: Partial<RoomSettings>): void {
    if (!samePlayer(actor, this.setting<PlayerIdDto>(HOST))) {
      Room.sendError(socket, 'NotHost');
      return;
    }
    const settings = this.setting<RoomSettings>(ROOM_SETTINGS);
    this.writeSetting(ROOM_SETTINGS, {
      ...settings,
      ...changes,
    });
    this.broadcast([]);
  }
  private setDeadline(kind: string, at: number): void {
    this.ctx.storage.sql.exec('INSERT INTO deadlines (kind, at) VALUES (?, ?) ON CONFLICT(kind) DO UPDATE SET at = excluded.at', kind, at);
  }
  private setDeadlineIfMissing(kind: string, at: number): void {
    this.ctx.storage.sql.exec('INSERT INTO deadlines (kind, at) VALUES (?, ?) ON CONFLICT(kind) DO NOTHING', kind, at);
  }
  private clearDeadline(kind: string): void {
    this.ctx.storage.sql.exec('DELETE FROM deadlines WHERE kind = ?', kind);
  }
  private bumpGc(): void {
    this.setDeadline('room_gc', Date.now() + DEADLINE_HORIZONS.roomGc);
    this.queueAlarm();
  }
  private queueAlarm(): void {
    const next = this.ctx.storage.sql
      .exec<{
        at: number;
      }>('SELECT COALESCE(MIN(at), 0) AS at FROM deadlines')
      .one();
    this.ctx.waitUntil(this.ctx.storage.setAlarm(next.at));
  }
  private refreshPresence(excluded?: WebSocket): void {
    if (this.optionalSetting<number>(CURRENT_GAME) === null) return;
    const present = this.presentPlayers(excluded);
    const now = Date.now();
    if (present.length === 0) {
      this.setDeadline('room_empty', now + DEADLINE_HORIZONS.roomEmpty);
    } else {
      this.clearDeadline('room_empty');
    }
    const host = this.setting<PlayerIdDto>(HOST);
    if (present.some(player => samePlayer(player, host))) {
      this.clearDeadline('host_absent');
    } else {
      this.setDeadlineIfMissing('host_absent', now + DEADLINE_HORIZONS.hostAbsent);
    }
    this.queueAlarm();
  }
  private prepareConnection(identity: VerifiedIdentity): {
    state: Snapshot;
    events: EventDto[];
  } | null {
    const game = this.game();
    const state = this.snapshot(game);
    const view = requireEngine(projectPlayer(state, identity.player));
    if (view.players.some(player => samePlayer(player, identity.player))) {
      this.addRoster(identity);
      return {
        state,
        events: [],
      };
    }
    if (!this.joinAllowed(identity.player)) return null;
    const joined = this.apply(game, identity.player, 'Join');
    if (!joined.ok) return null;
    this.addRoster(identity);
    return joined.value;
  }
  private gameLog(player: PlayerIdDto, gameIndex: number): Response {
    const game = this.gameAt(gameIndex);
    if (game === null) {
      return errorJson('GameNotFound', 404);
    }
    if (game.phase !== 'Finished') {
      return errorJson('GameNotFinished', 409);
    }
    if (game.commitment === null) {
      return errorJson('GameNotStarted', 409);
    }
    const startRoster = decodeStored<PlayerIdDto[]>(game.roster);
    if (!this.rosterHas(player) && !startRoster.some(member => samePlayer(member, player))) {
      return errorJson('NotMember', 403);
    }
    const response: GameLogResponse = {
      type: 'gameLog',
      gameIndex,
      host: this.setting<PlayerIdDto>(`${INITIAL_HOST_PREFIX}${gameIndex}`),
      log: this.events(gameIndex),
    };
    return Response.json(response);
  }
  public fetch(request: Request): Response {
    const identity = decodeIdentity(request.headers.get(VERIFIED_IDENTITY_HEADER));
    if (identity === null) {
      return errorJson('Unauthorized', 401);
    }
    const roomId = request.headers.get(ROOM_KEY_HEADER);
    if (roomId === null || roomId.length === 0) {
      return errorJson('MissingRoom', 400);
    }
    const mode = request.headers.get(ROOM_MODE_HEADER);
    if (mode !== 'log' && mode !== 'state' && mode !== 'websocket') {
      return errorJson('InvalidMode', 400);
    }
    const existing = this.optionalSetting<number>(CURRENT_GAME);
    if (mode === 'websocket') {
      const pair = new WebSocketPair();
      const { 0: client, 1: server } = pair;
      this.ctx.acceptWebSocket(server);
      // The identity schema bounds every string it carries, which is what keeps this attachment inside the size a socket can hold.
      server.serializeAttachment(identity);
      if (existing === null) this.createRoom(roomId, identity);
      const connection = this.prepareConnection(identity);
      if (connection === null) {
        server.close(1008, 'Join rejected');
        return errorJson('JoinRejected', 409);
      }
      if (connection.events.length === 0) {
        this.sendSnapshot(server, identity.player);
      } else {
        this.broadcast(connection.events);
      }
      this.refreshPresence();
      this.bumpGc();
      const headers = new Headers();
      const selectedProtocol = request.headers.get(SELECTED_PROTOCOL_HEADER);
      if (selectedProtocol !== null) {
        headers.set('Sec-WebSocket-Protocol', selectedProtocol);
      }
      return new Response(null, {
        status: 101,
        headers,
        webSocket: client,
      });
    }
    if (existing === null) {
      return errorJson('RoomNotFound', 404);
    }
    if (mode === 'log') return this.gameLog(identity.player, Number(request.headers.get(GAME_INDEX_HEADER)));
    if (!this.rosterHas(identity.player)) {
      return errorJson('NotMember', 403);
    }
    const game = this.game();
    return Response.json(this.snapshotMessage(this.snapshot(game), game, identity.player));
  }
  private withinMessageRate(socket: WebSocket): boolean {
    const now = Date.now();
    const rate = this.messageRates.get(socket);
    if (rate === undefined || now - rate.startedAt >= DEADLINE_HORIZONS.messageRateWindow) {
      this.messageRates.set(socket, {
        startedAt: now,
        count: 1,
      });
      return true;
    }
    if (rate.count >= DEADLINE_HORIZONS.messageRateLimit) return false;
    rate.count += 1;
    return true;
  }
  public webSocketMessage(socket: WebSocket, value: string | ArrayBuffer): void {
    if (!this.withinMessageRate(socket)) {
      Room.sendError(socket, 'RateLimited');
      return;
    }
    const identity = Room.socketIdentity(socket);
    if (identity === null) {
      Room.sendError(socket, 'MissingIdentity');
      return;
    }
    this.bumpGc();
    const parsed = parseMessage(value);
    if (!parsed.ok) {
      Room.sendError(socket, parsed.code);
      return;
    }
    const { value: message } = parsed;
    if (message.type === 'resync') {
      this.sendSnapshot(socket, identity.player);
      return;
    }
    if (message.type === 'command') {
      this.handleCommand(socket, identity, message.command);
      return;
    }
    if (message.type === 'newGame') {
      this.handleNewGame(socket, identity, message.config);
      return;
    }
    this.handleSettings(socket, identity.player, message.settings);
  }
  public webSocketClose(socket: WebSocket): void {
    this.refreshPresence(socket);
  }
  public webSocketError(socket: WebSocket): void {
    this.refreshPresence(socket);
  }
  private closeCurrentGame(): void {
    const game = this.game();
    if (game.phase === 'Finished') {
      this.clearDeadline('reveal_backstop');
      return;
    }
    const host = this.setting<PlayerIdDto>(HOST);
    const closed = this.apply(game, host, 'Close', 'Finished');
    if (closed.ok) {
      this.clearDeadline('reveal_backstop');
      this.broadcast(closed.value.events);
    }
  }
  private expireHostAbsence(): void {
    if (this.setting<RoomSettings>(ROOM_SETTINGS).hostAutoClose) {
      this.closeCurrentGame();
      return;
    }
    const host = this.setting<PlayerIdDto>(HOST);
    const target = this.presentPlayers().find(player => !samePlayer(player, host));
    if (target === undefined) {
      this.setDeadline('room_empty', Date.now() + DEADLINE_HORIZONS.roomEmpty);
      return;
    }
    const game = this.game();
    if (game.phase === 'Finished') {
      this.writeSetting(HOST, target);
      this.broadcast([]);
      return;
    }
    const transfer = this.apply(game, host, {
      TransferHost: {
        target,
      },
    });
    if (!transfer.ok) return;
    this.writeSetting(HOST, target);
    this.broadcast(transfer.value.events);
  }
  public async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.ctx.storage.sql.exec<DeadlineRow>('SELECT kind, at FROM deadlines WHERE at <= ? ORDER BY at, kind', now).toArray();
    let shouldResetRoom = false;
    for (const deadline of due) {
      this.clearDeadline(deadline.kind);
      if (deadline.kind === 'room_gc') {
        if (this.presentPlayers().length > 0) {
          this.setDeadline('room_gc', now + DEADLINE_HORIZONS.roomGc);
        } else {
          shouldResetRoom = true;
          break;
        }
      }
      if (deadline.kind === 'host_absent') this.expireHostAbsence();
      if (deadline.kind === 'room_empty' && this.presentPlayers().length === 0) {
        this.closeCurrentGame();
      }
      if (deadline.kind === 'reveal_backstop') this.closeCurrentGame();
    }
    if (shouldResetRoom) {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'Room expired');
      await this.ctx.storage.deleteAll();
      this.createSchema();
      return;
    }
    const next = this.ctx.storage.sql
      .exec<{
        at: number | null;
      }>('SELECT MIN(at) AS at FROM deadlines')
      .one();
    await (next.at === null ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(next.at));
  }
}
