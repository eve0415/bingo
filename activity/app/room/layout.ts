/**
 * Layout is decided from the measured frame, never from a device breakpoint: Discord hands the activity a phone, a landscape phone, a laptop pane and an ultra-wide,
 * and the only thing that must hold everywhere is that a running game fits without scrolling and without the card moving under a thumb.
 */
export interface Measure {
  readonly width: number;
  readonly height: number;
}

const TOUCH = 44;
const CARD_PAD = 12;
const CARD_MAX = 560;
const RAIL = 320;
const CALL_COLUMN = 280;
const HEADER = 48;
const EDGE = 16;
const DENSE_EDGE = 8;
const DENSE_WIDTH = 420;
const GAP = 16;
const CALL_HERO = 168;
const CALL_COMPACT = 56;
const HISTORY = TOUCH + 8;
const RESERVED_REACH = 24;
const RESERVED_TOAST = 48;
const FOOTER = 52 + 12 + 16;
/** The B-I-N-G-O header the 5x5 card carries, plus the gap under it. */
const LETTERS = 28 + 8;

const GAPS = new Map([
  [3, 6],
  [5, 6],
  [7, 4],
  [9, 3],
]);

const gapFor = (size: number): number => GAPS.get(size) ?? 3;

/** A narrow frame buys its content back out of the page gutters, whichever screen is in it. */
export const isDense = ({ width }: Measure): boolean => width < DENSE_WIDTH;

/** Below this the cells would fall under the touch floor, which the design refuses before it refuses anything else. */
export const cardMinWidth = (size: number): number => size * TOUCH + (size - 1) * gapFor(size) + 2 * CARD_PAD;

const lettersFor = (size: number): number => (size === 5 ? LETTERS : 0);

type Arrangement = 'stack' | 'row' | 'desk';
export type CallVariant = 'hero' | 'compact';

export interface PlayerLayout {
  readonly arrangement: Arrangement;
  /** What the height budget assumed was on screen; the player renders from these rather than re-deriving them. */
  readonly showCall: boolean;
  readonly footer: boolean;
  readonly cardMax: number;
  readonly callVariant: CallVariant;
  readonly showHistory: boolean;
  readonly dense: boolean;
  /** The frame cannot hold a full-pitch card. Scrolling the card area is the lesser defect; clipping it is not an option. */
  readonly tight: boolean;
}

/** A switcher stacked under the call, a switcher beside it, two columns, or the desk's three. */
export type Columns = 'one' | 'beside' | 'split' | 'desk';

export interface HostLayout {
  readonly columns: Columns;
  readonly callVariant: CallVariant;
  readonly cardMax: number;
}

export interface PlayerNeeds {
  /** False when the room is hiding the draw, which replaces the call box with a one-line note the height of a compact call. */
  readonly showCall: boolean;
  /** The claim control, which only a room using claimed wins ever shows. */
  readonly footer: boolean;
}

const chromeHeight = (variant: CallVariant, history: boolean, needs: PlayerNeeds, edge: number): number =>
  HEADER +
  (variant === 'hero' ? CALL_HERO : CALL_COMPACT) +
  (history ? HISTORY : 0) +
  GAP +
  RESERVED_REACH +
  16 +
  RESERVED_TOAST +
  (needs.footer ? FOOTER : 0) +
  edge;

/** Richest arrangement first: the call history is the first thing a short frame gives up, and the hero call is the second. */
const LADDER = [
  {
    callVariant: 'hero',
    showHistory: true,
  },
  {
    callVariant: 'hero',
    showHistory: false,
  },
  {
    callVariant: 'compact',
    showHistory: false,
  },
] as const satisfies readonly { callVariant: CallVariant; showHistory: boolean }[];

/**
 * Three arrangements, chosen by what actually fits: a desk with a rail, a landscape row with the call beside the card, or the phone stack with the call above it.
 * The row exists because a landscape phone has the width for a rail and nowhere near the height for a stack; it drops the header for the same reason.
 */
export const playerLayout = ({ width, height }: Measure, size: number, needs: PlayerNeeds): PlayerLayout => {
  const dense = isDense({ width, height });
  const edge = dense ? DENSE_EDGE : EDGE;
  const floor = cardMinWidth(size);
  const desk = width >= 1024 && height >= 560;
  const across = width - 2 * edge - (desk ? RAIL + 2 * edge : 0);
  const result = (arrangement: Arrangement, cardMax: number, callVariant: CallVariant, showHistory: boolean, tight: boolean): PlayerLayout => ({
    arrangement,
    showCall: needs.showCall,
    footer: needs.footer,
    cardMax,
    callVariant,
    showHistory,
    dense,
    tight,
  });
  for (const step of LADDER) {
    const history = needs.showCall && step.showHistory;
    const variant = needs.showCall ? step.callVariant : 'compact';
    const down = height - chromeHeight(variant, history, needs, edge) - lettersFor(size);
    const card = Math.min(CARD_MAX, across, down);
    if (card >= floor) return result(desk ? 'desk' : 'stack', card, variant, history, false);
  }
  const down = height - 2 * edge - (needs.footer ? FOOTER : 0);
  const rowCard = Math.min(CARD_MAX, down - lettersFor(size), width - CALL_COLUMN - 3 * edge);
  if (!desk && width >= CALL_COLUMN * 2 && rowCard >= floor) {
    // The column beside the card carries the call, the reach line, the notice and the roster control, and has to fit as surely as the card does.
    const besideHero = CALL_HERO + RESERVED_REACH + RESERVED_TOAST + TOUCH + 3 * 8;
    const variant: CallVariant = needs.showCall && besideHero <= down ? 'hero' : 'compact';
    return result('row', rowCard, variant, false, false);
  }
  return result(desk ? 'desk' : 'stack', floor, 'compact', false, true);
};

/** The host reads a flashboard, a roster and their own card; how many of the three sit side by side is all the width decides. */
/** What a stacked switcher spends before the panel gets anything: header, call, notice, tabs, the pinned draw controls and the page edges. */
const HOST_CHROME = HEADER + CALL_COMPACT + RESERVED_TOAST + TOUCH + FOOTER + 2 * EDGE;
/** Five rows of a 15-wide flashboard, which is the tallest thing a panel has to hold. */
const PANEL_MIN = 140;

export const hostLayout = ({ width, height }: Measure, size: number): HostLayout => {
  const clamp = (available: number): number => Math.max(cardMinWidth(size), Math.min(CARD_MAX, available));
  if (width < 680 || height < 560) {
    // Stacking the call above the switcher costs more height than a short frame has, so there the call moves beside it instead.
    const beside = height - HOST_CHROME < PANEL_MIN && width >= CALL_COLUMN * 2;
    return {
      columns: beside ? 'beside' : 'one',
      callVariant: 'compact',
      cardMax: clamp(Math.min(width - 2 * EDGE - (beside ? CALL_COLUMN + EDGE : 0), height)),
    };
  }
  if (width >= 1100) {
    return {
      columns: 'desk',
      callVariant: 'hero',
      cardMax: clamp(420),
    };
  }
  return {
    columns: 'split',
    callVariant: 'hero',
    cardMax: clamp(width / 2 - 3 * EDGE),
  };
};

/** The lobby has no card to protect, so it splits into two columns as soon as there is width for two readable ones. */
export const lobbyColumns = ({ width }: Measure): Columns => (width >= 900 ? 'split' : 'one');
