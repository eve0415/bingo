import type { CardViewDto } from '@bingo/wasm/CardViewDto';

import { describe, expect, it } from 'vitest';

import { cardCells, isReach, letterOf, markCount, poolSize, strikeLines } from '../../app/room/lines';

import { ME, card } from './fixture';

const marked = (): CardViewDto => ({
  ...card(ME),
  marked: [5, 12],
  bingo: [[0, 1, 2, 3, 4]],
  reach: [[7, 12]],
});

describe('card geometry', () => {
  it('sizes the pool from the side length', (): void => {
    expect(poolSize(5)).toBe(75);
    expect(poolSize(3)).toBe(45);
  });

  it('letters only the five-wide card', (): void => {
    expect(letterOf(1, 5)).toBe('B');
    expect(letterOf(31, 5)).toBe('N');
    expect(letterOf(75, 5)).toBe('O');
    expect(letterOf(1, 7)).toBeNull();
  });
});

describe('card cells', () => {
  it('gives every cell the state the player needs to see', (): void => {
    const cells = cardCells(marked(), [6]);
    expect(cells[0]).toEqual({
      number: 1,
      free: false,
      state: 'winning',
    });
    expect(cells[5].state).toBe('marked');
    expect(cells[6].state).toBe('pending');
    expect(cells[7].state).toBe('reach');
    expect(cells[8].state).toBe('open');
  });

  it('marks the free centre as free rather than as a number', (): void => {
    const cells = cardCells(marked(), []);
    expect(cells[12]).toEqual({
      number: 0,
      free: true,
      state: 'marked',
    });
  });

  it('acknowledges an in-flight unmark as plainly as an in-flight mark', (): void => {
    const cells = cardCells(marked(), [5]);
    expect(cells[5].state).toBe('pending');
  });

  it('keeps a reach cell only while it is still standing in the way', (): void => {
    const cells = cardCells(
      {
        ...card(ME),
        marked: [12],
        reach: [[7, 12]],
      },
      [],
    );
    expect(cells[7].state).toBe('reach');
    expect(cells[12].state).toBe('marked');
  });
});

describe('strike lines', () => {
  it('recognises rows, columns and both diagonals', (): void => {
    expect(
      strikeLines(
        [
          [0, 1, 2],
          [1, 4, 7],
          [0, 4, 8],
          [2, 4, 6],
        ],
        3,
      ),
    ).toEqual([
      { kind: 'row', index: 0 },
      { kind: 'col', index: 1 },
      { kind: 'diag', index: 0 },
      { kind: 'diag', index: 1 },
    ]);
  });

  it('draws no bar through a pattern that is not a straight line', (): void => {
    expect(strikeLines([[0, 1]], 3)).toEqual([]);
    expect(strikeLines([[0, 1, 5]], 3)).toEqual([]);
  });
});

describe('card progress', () => {
  it('reports reach only while nothing has completed', (): void => {
    expect(isReach({ ...card(ME), reach: [[7]] })).toBe(true);
    expect(isReach({ ...card(ME), bingo: [[0]], reach: [[7]] })).toBe(false);
    expect(isReach(card(ME))).toBe(false);
  });

  it('counts the marks on a card', (): void => {
    expect(markCount(marked())).toBe(2);
  });
});
