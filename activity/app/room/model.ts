import type { CalledEntry } from './call';
import type { PlayerStatus } from './chip';
import type { PendingMark, RoomState } from './connection';
import type { ProfileLookup } from './profiles';
import type { RosterEntry, RosterMarks } from './roster';
import type { Overlay, OverlayKind } from './uiState';
import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { DaubDto } from '@bingo/wasm/DaubDto';
import type { PhaseDto } from '@bingo/wasm/PhaseDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { WinLimitDto } from '@bingo/wasm/WinLimitDto';
import type { RoomView } from '@bingo/wrapper/protocol';

import { playerKey, samePlayer } from '@bingo/wrapper/identity';

import { letterOf, markCount, poolSize } from './lines';
import { avatarOf, nameOf, seedOf } from './profiles';

/** How much of the draw the room is willing to show, which the host is subject to as well. */
export type Visibility = 'Full' | 'LatestOnly' | 'Hidden';

const called = (value: number, size: number): CalledEntry => ({
  value,
  letter: letterOf(value, size),
});

export const calledEntries = (drawnOrder: readonly number[], size: number): { latest: CalledEntry | null; history: CalledEntry[] } => {
  const last = drawnOrder.at(-1);
  return {
    latest: last === undefined ? null : called(last, size),
    history: drawnOrder
      .slice(0, -1)
      .toReversed()
      .map(value => called(value, size)),
  };
};

/** Under restricted visibility the count would report the one number the room is still willing to show, which is not progress. */
export const progressLabel = (drawn: number, size: number, visibility: Visibility): string => (visibility === 'Full' ? `${drawn} / ${poolSize(size)}` : '—');

export const cardsOf = (view: RoomView, player: PlayerIdDto): CardViewDto[] => view.cards.filter(card => samePlayer(card.owner, player));

/** A player's projection carries only their own cards, so a win is read from the roll of recognised winners, which every recipient gets. */
const hasWon = (view: RoomView, player: PlayerIdDto): boolean => view.wins.some(win => win.winners.some(winner => samePlayer(winner, player)));

export const statusOf = (view: RoomView, player: PlayerIdDto, cards: readonly CardViewDto[]): PlayerStatus => {
  if (samePlayer(player, view.host)) return 'host';
  if (hasWon(view, player) || cards.some(card => card.bingo.length > 0)) return 'bingo';
  if (cards.some(card => card.reach.length > 0)) return 'reach';
  return view.phase === 'Running' ? 'playing' : 'waiting';
};

const marksOf = (view: RoomView, cards: readonly CardViewDto[]): RosterMarks | null => {
  // No cards means the projection withheld them, not that the player has marked nothing.
  if (view.phase !== 'Running' || cards.length === 0) return null;
  return {
    marked: cards.reduce((total, card) => total + markCount(card), 0),
    total: cards.length * view.config.size * view.config.size,
  };
};

export interface RosterMember {
  readonly entry: RosterEntry;
  readonly player: PlayerIdDto;
  readonly cards: readonly CardViewDto[];
}

/** The room knows players as issuer and subject; everything a person recognises — a name, a picture, a colour, a status — is assembled here. */
export const rosterMembers = (view: RoomView, me: PlayerIdDto, profiles: ProfileLookup): RosterMember[] =>
  view.players.map(player => {
    const cards = cardsOf(view, player);
    return {
      player,
      cards,
      entry: {
        key: playerKey(player),
        name: nameOf(player, profiles),
        status: statusOf(view, player, cards),
        seed: seedOf(player),
        avatar: avatarOf(player, profiles),
        isYou: samePlayer(player, me),
        isHost: samePlayer(player, view.host),
        marks: marksOf(view, cards),
      },
    };
  });

/** Whoever an overlay is about, once the roster is what decides whether they are still here. */
export const overlayMember = (overlay: Overlay, members: readonly RosterMember[], kinds: readonly OverlayKind[]): RosterMember | null =>
  members.find(member => (overlay !== null && 'player' in overlay && kinds.includes(overlay.kind) ? member.entry.key === overlay.player : false)) ?? null;

export interface FlashCell {
  readonly value: number;
  readonly called: boolean;
  readonly live: boolean;
}

/** The flashboard is the printed board a caller crosses off: one row per column range, every number in its own place. */
export const flashboard = (drawnOrder: readonly number[], size: number): { letter: string | null; cells: FlashCell[] }[] => {
  const drawn = new Set(drawnOrder);
  const latest = drawnOrder.at(-1);
  const perRow = poolSize(size) / size;
  return Array.from({ length: size }, (_unusedRow, row) => ({
    letter: letterOf(row * perRow + 1, size),
    cells: Array.from({ length: perRow }, (_unusedCell, column) => {
      const value = row * perRow + column + 1;
      return {
        value,
        called: drawn.has(value),
        live: value === latest,
      };
    }),
  }));
};

export const visibilityOf = (state: RoomState): Visibility => state.room?.settings.drawnVisibility ?? 'Full';

export const isHost = (view: RoomView, me: PlayerIdDto): boolean => samePlayer(view.host, me);

export const isSeated = (view: RoomView, me: PlayerIdDto): boolean => view.players.some(player => samePlayer(player, me));

export const DAUB_LABEL = {
  Auto: '自動',
  Manual: '自分でタップ',
} as const satisfies Record<DaubDto, string>;

export const VISIBILITY_LABEL = {
  Full: 'すべて',
  LatestOnly: '最新だけ',
  Hidden: '隠す',
} as const satisfies Record<Visibility, string>;

export const PHASE_LABEL = {
  Lobby: '待機中',
  Running: 'プレイ中',
  Finished: '終了',
} as const satisfies Record<PhaseDto, string>;

/** How many people have to reach bingo before the game closes itself; the default is nobody, so the host closes it. */
export const winLimitLabel = (limit: WinLimitDto): string => {
  if (limit === 'Unlimited') return '最後まで';
  return limit === 'FirstOnly' ? '1人' : `${limit.Count}人`;
};

export const sameWinLimit = (left: WinLimitDto, right: WinLimitDto): boolean => {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return left.Count === right.Count;
};

/** The published commitment is split into readable runs; it is evidence, not decoration, so it is shown in full or not at all. */
export const commitmentText = (commitment: string | null): string => (commitment === null ? '—' : commitment.replaceAll(/(?<run>.{16})/gu, '$<run> ').trim());

/** A sent mark is drawn on the cell it targets, so the tap is acknowledged before the room answers. */
export const pendingFor = (pending: readonly PendingMark[], cardIx: number, size: number): number[] =>
  pending.filter(mark => mark.cardIx === cardIx).map(mark => mark.row * size + mark.col);

export interface WinnerGroup {
  readonly rank: number;
  readonly names: string;
}

/** Winners that share a rank are named as equals, because the engine recognised them at the same sequence. */
export const winnerGroups = (view: RoomView, profiles: ProfileLookup): WinnerGroup[] =>
  view.wins.map(win => ({
    rank: win.rank,
    names: win.winners.map(winner => nameOf(winner, profiles)).join('、'),
  }));

/** Cards belonging to anyone the room recognised, which is every winner for the host and only their own for a player. */
export const winnerCards = (view: RoomView): CardViewDto[] => {
  const winners = new Set(view.wins.flatMap(win => win.winners.map(winner => playerKey(winner))));
  return view.cards.filter(card => winners.has(playerKey(card.owner)));
};

/** What the room refused, said in the room's own words rather than in the protocol's. */
const FAILURE_TEXT = new Map([
  ['NotHost', 'この操作はホストだけができます'],
  ['NotConnected', 'まだ接続していません'],
  ['MalformedMessage', '通信が読み取れませんでした'],
  ['WrongPhase', 'いまはその操作ができません'],
  ['NoBingo', 'そろっている列がありません'],
  ['NotAParticipant', 'このゲームには参加していません'],
  ['RoomLocked', 'このゲームは締め切られています。次のゲームから参加できます'],
  ['NumberNotDrawn', 'その番号はまだ呼ばれていません'],
  ['NumberNotOnCard', 'その番号はカードにありません'],
  ['NothingToUndo', '取り消せる番号がありません'],
  ['NoNumbersRemain', '番号をすべて引きました'],
  ['BacklogMarkNotAllowed', '参加する前に呼ばれた番号はマークできません'],
  ['RateLimited', '操作が速すぎます。少し待ってください'],
]);

/** Nothing here reconnects, so the notice says what happened and what to do rather than promising a recovery that is not coming. */
const CLOSE_TEXT = new Map([
  ['Kicked', 'この部屋から外れました。ホストに聞いてみてください'],
  ['Join rejected', 'この部屋には入れませんでした。ホストに聞いてみてください'],
  ['Room expired', 'この部屋は時間切れで閉じました'],
]);

export const noticeOf = (state: RoomState): string | null => {
  if (state.status === 'connecting') return '接続しています';
  if (state.status === 'closed') {
    // The close code is the same for a kick and for a refused join, so the reason beside it is what tells them apart.
    return CLOSE_TEXT.get(state.closure?.reason ?? '') ?? '接続が切れました。アクティビティを開き直してください';
  }
  if (state.failure === null) return null;
  return FAILURE_TEXT.get(state.failure.code) ?? `操作できませんでした（${state.failure.code}）`;
};
