import type { CardViewDto } from '@bingo/wasm/CardViewDto';

/** Every card column draws from a fixed run of fifteen numbers, so the pool and the column of a number both follow from the side length. */
const NUMBERS_PER_COLUMN = 15;
/** The column letters a 5x5 card carries, which are also what names a drawn number. */
export const LETTERS = ['B', 'I', 'N', 'G', 'O'];

export type CellState = 'open' | 'pending' | 'marked' | 'reach' | 'winning';

export interface CardCellView {
  readonly number: number;
  readonly free: boolean;
  readonly state: CellState;
  /** The cell the room has just called, which the card holds back until the reel has finished rolling it. */
  readonly live: boolean;
}

export interface StrikeLine {
  readonly kind: 'row' | 'col' | 'diag';
  readonly index: number;
}

export const poolSize = (size: number): number => size * NUMBERS_PER_COLUMN;

/** Only the 5×5 card carries B-I-N-G-O column letters; the larger boards have none. */
export const letterOf = (value: number, size: number): string | null =>
  size === LETTERS.length ? LETTERS[Math.floor((value - 1) / NUMBERS_PER_COLUMN)] : null;

const union = (patterns: readonly (readonly number[])[]): Set<number> => new Set(patterns.flat());

/**
 * Reach is drawn on the cell that would complete the line rather than on the line itself, because that is the cell the player is waiting for.
 * A pattern the engine reports as reach has exactly the unmarked cells that still stand in the way.
 */
const reachCells = (card: CardViewDto): Set<number> => {
  const marked = new Set(card.marked);
  return new Set(card.reach.flat().filter(index => !marked.has(index)));
};

const state = (index: number, sets: { winning: Set<number>; marked: Set<number>; reach: Set<number>; sent: Set<number> }): CellState => {
  if (sets.winning.has(index)) return 'winning';
  // A mark this client has sent outranks the room's last word about the cell, so an in-flight unmark is acknowledged as plainly as an in-flight mark.
  if (sets.sent.has(index)) return 'pending';
  if (sets.marked.has(index)) return 'marked';
  return sets.reach.has(index) ? 'reach' : 'open';
};

/**
 * The generator leaves the free centre at zero, and the engine marks it before the first draw.
 * `live` is the number the room has just called, or null wherever nothing is rolling it: a card marked by hand answers the tap, not the draw.
 */
export const cardCells = (card: CardViewDto, pending: readonly number[], live: number | null): CardCellView[] => {
  const winning = union(card.bingo);
  const marked = new Set(card.marked);
  const reach = reachCells(card);
  const sent = new Set(pending);
  return card.cells.map((value, index) => {
    const cell = state(index, {
      winning,
      marked,
      reach,
      sent,
    });
    return {
      number: value,
      free: value === 0,
      state: cell,
      live: value === live && (cell === 'marked' || cell === 'winning'),
    };
  });
};

const lineOf = (pattern: readonly number[], size: number): StrikeLine | null => {
  if (pattern.length !== size) return null;
  const sorted = pattern.toSorted((left, right) => left - right);
  const row = Math.floor(sorted[0] / size);
  if (sorted.every((index, offset) => index === row * size + offset)) {
    return {
      kind: 'row',
      index: row,
    };
  }
  const column = sorted[0] % size;
  if (sorted.every((index, offset) => index === offset * size + column)) {
    return {
      kind: 'col',
      index: column,
    };
  }
  if (sorted.every((index, offset) => index === offset * size + offset)) {
    return {
      kind: 'diag',
      index: 0,
    };
  }
  return sorted.every((index, offset) => index === offset * size + (size - 1 - offset))
    ? {
        kind: 'diag',
        index: 1,
      }
    : null;
};

/** A completed pattern is struck through only when it is a straight line; a configured shape has no bar to draw. */
export const strikeLines = (patterns: readonly (readonly number[])[], size: number): StrikeLine[] =>
  patterns.map(pattern => lineOf(pattern, size)).filter((line): line is StrikeLine => line !== null);

export const isReach = (card: CardViewDto): boolean => card.bingo.length === 0 && card.reach.length > 0;

export const markCount = (card: CardViewDto): number => card.marked.length;
