import { describe, expect, it } from 'vitest';

import { cardMinWidth, hostLayout, isDense, lobbyColumns, playerLayout } from '../../app/room/layout';

const CALLED_AND_CLAIMED = {
  showCall: true,
  footer: true,
};
const CALLED_ONLY = {
  showCall: true,
  footer: false,
};
const HIDDEN_AND_CLAIMED = {
  showCall: false,
  footer: true,
};
const HIDDEN_ONLY = {
  showCall: false,
  footer: false,
};

describe('card minimum width', () => {
  it('keeps every cell above the touch floor at each offered size', (): void => {
    expect(cardMinWidth(3)).toBe(168);
    expect(cardMinWidth(5)).toBe(268);
    expect(cardMinWidth(7)).toBe(356);
    expect(cardMinWidth(9)).toBe(444);
  });

  it('falls back to the tightest gap for a size the room does not offer', (): void => {
    expect(cardMinWidth(4)).toBe(209);
  });
});

describe('the player layout on a frame that fits', () => {
  it('keeps the rail, the hero call and the history on a desk', (): void => {
    expect(playerLayout({ width: 1280, height: 800 }, 5, CALLED_AND_CLAIMED)).toEqual({
      arrangement: 'desk',
      showCall: true,
      footer: true,
      cardMax: 296,
      callVariant: 'hero',
      showHistory: true,
      dense: false,
      tight: false,
    });
  });

  it('tightens the edges of a phone and drops the call box the room is hiding', (): void => {
    expect(playerLayout({ width: 390, height: 844 }, 5, HIDDEN_ONLY)).toEqual({
      arrangement: 'stack',
      showCall: false,
      footer: false,
      cardMax: 374,
      callVariant: 'compact',
      showHistory: false,
      dense: true,
      tight: false,
    });
  });

  it('gives up the history first and the hero call second as the frame shortens', (): void => {
    expect(playerLayout({ width: 500, height: 600 }, 5, CALLED_ONLY)).toEqual({
      arrangement: 'stack',
      showCall: true,
      footer: false,
      cardMax: 340,
      callVariant: 'compact',
      showHistory: false,
      dense: false,
      tight: false,
    });
  });
});

describe('the player layout on a landscape frame', () => {
  it('puts the call beside the card once the stack has run out of height', (): void => {
    expect(playerLayout({ width: 700, height: 360 }, 3, CALLED_ONLY)).toEqual({
      arrangement: 'row',
      showCall: true,
      footer: false,
      cardMax: 328,
      callVariant: 'hero',
      showHistory: false,
      dense: false,
      tight: false,
    });
  });

  // The same frame as the row above, differing only in the claim: the card gives up exactly the footer's height for it.
  // The same frame as the row above, 40px shorter: the side column can no longer hold a hero call beside the card.
  it('drops the row to a compact call when the column beside the card is too short for a hero one', (): void => {
    expect(playerLayout({ width: 700, height: 320 }, 3, CALLED_ONLY)).toEqual({
      arrangement: 'row',
      showCall: true,
      footer: false,
      cardMax: 288,
      callVariant: 'compact',
      showHistory: false,
      dense: false,
      tight: false,
    });
  });

  it('keeps the row compact, and leaves it room for the claim, while the room is hiding the draw', (): void => {
    expect(playerLayout({ width: 700, height: 360 }, 3, HIDDEN_AND_CLAIMED)).toEqual({
      arrangement: 'row',
      showCall: false,
      footer: true,
      cardMax: 248,
      callVariant: 'compact',
      showHistory: false,
      dense: false,
      tight: false,
    });
  });
});

describe('the player layout on a frame that cannot hold the card', () => {
  it('scrolls a full-pitch card rather than shrinking it on a narrow phone', (): void => {
    expect(playerLayout({ width: 360, height: 300 }, 9, CALLED_AND_CLAIMED)).toEqual({
      arrangement: 'stack',
      showCall: true,
      footer: true,
      cardMax: 444,
      callVariant: 'compact',
      showHistory: false,
      dense: true,
      tight: true,
    });
  });

  it('keeps the desk arrangement even where the desk has no height for the card', (): void => {
    expect(playerLayout({ width: 1024, height: 560 }, 9, CALLED_ONLY)).toEqual({
      arrangement: 'desk',
      showCall: true,
      footer: false,
      cardMax: 444,
      callVariant: 'compact',
      showHistory: false,
      dense: false,
      tight: true,
    });
  });

  it('refuses the row when the row would shrink the card below its floor', (): void => {
    expect(playerLayout({ width: 700, height: 360 }, 9, CALLED_ONLY)).toEqual({
      arrangement: 'stack',
      showCall: true,
      footer: false,
      cardMax: 444,
      callVariant: 'compact',
      showHistory: false,
      dense: false,
      tight: true,
    });
  });
});

describe('the host layout', () => {
  it('sits the flashboard, the roster and the card side by side on a wide frame', (): void => {
    expect(hostLayout({ width: 1200, height: 800 }, 5)).toEqual({
      columns: 'desk',
      callVariant: 'hero',
      cardMax: 420,
    });
  });

  it('splits into two columns on a middling frame', (): void => {
    expect(hostLayout({ width: 800, height: 600 }, 5)).toEqual({
      columns: 'split',
      callVariant: 'hero',
      cardMax: 352,
    });
  });

  it('falls back to one column and a switcher on a phone', (): void => {
    expect(hostLayout({ width: 400, height: 700 }, 5)).toEqual({
      columns: 'one',
      callVariant: 'compact',
      cardMax: 368,
    });
  });

  it('puts the call beside the switcher on a frame with no height to stack them', (): void => {
    expect(hostLayout({ width: 900, height: 400 }, 5)).toEqual({
      columns: 'beside',
      callVariant: 'compact',
      cardMax: 400,
    });
  });

  it('keeps the call above the switcher on a frame too narrow to sit them side by side', (): void => {
    expect(hostLayout({ width: 400, height: 400 }, 5)).toEqual({
      columns: 'one',
      callVariant: 'compact',
      cardMax: 368,
    });
  });
});

describe('the lobby width', () => {
  it('splits only once there is room for two readable columns', (): void => {
    expect(lobbyColumns({ width: 900, height: 400 })).toBe('split');
    expect(lobbyColumns({ width: 899, height: 400 })).toBe('one');
  });
});

describe('a dense frame', () => {
  it('tightens the edges only on a frame narrower than a large phone', (): void => {
    expect(isDense({ width: 390, height: 844 })).toBe(true);
    expect(isDense({ width: 420, height: 844 })).toBe(false);
  });
});
