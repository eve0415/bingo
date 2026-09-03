import type { Scene } from '../../app/preview/fixtures';
import type { RoomView } from '@bingo/wrapper/protocol';

import { describe, expect, it } from 'vitest';

import { NAMES, SCENES, SIZES, isScene } from '../../app/preview/fixtures';

const RUN = 15;

const viewOf = (scene: Scene, size: number): RoomView => {
  const { view } = SCENES[scene](size).state;
  if (view === null) throw new Error(`the ${scene} scene built no view`);
  return view;
};

const centreOf = (size: number): number => Math.floor(size / 2) * size + Math.floor(size / 2);

describe('the preview room', () => {
  it('seats a named table and offers every board size', (): void => {
    expect(SIZES).toEqual([3, 5, 7, 9]);
    expect(NAMES.size).toBe(6);
    expect([...NAMES.values()]).toContain('ゆうき');
  });

  it('recognises the scenes it has and refuses the ones it does not', (): void => {
    expect(isScene('player-hidden')).toBe(true);
    expect(isScene('win')).toBe(true);
    expect(isScene('spectator')).toBe(false);
    expect(isScene('constructor')).toBe(false);
    expect(isScene('toString')).toBe(false);
  });

  it('builds every scene at every size', (): void => {
    for (const build of Object.values(SCENES)) {
      for (const size of SIZES) {
        const { state } = build(size);
        expect(state.view?.config.size).toBe(size);
        expect(state.view?.players).toHaveLength(6);
        expect(state.view?.cards).toHaveLength(6);
      }
    }
  });

  it('calls the game for the host and plays it as somebody else', (): void => {
    expect(SCENES.host(5).me).toEqual(SCENES.lobby(5).me);
    expect(SCENES.player(5).me).not.toEqual(SCENES.host(5).me);
  });
});

describe('the preview cards', () => {
  it('leaves the centre free and draws every column from its own run of fifteen', (): void => {
    for (const size of SIZES) {
      const centre = centreOf(size);
      for (const card of viewOf('player', size).cards) {
        expect(card.cells).toHaveLength(size * size);
        expect(card.cells[centre]).toBe(0);
        const offCentre = card.cells.map((value, index) => ({ value, index })).filter(cell => cell.index !== centre);
        for (const cell of offCentre) {
          const column = cell.index % size;
          expect(cell.value).toBeGreaterThan(column * RUN);
          expect(cell.value).toBeLessThanOrEqual((column + 1) * RUN);
        }
      }
    }
  });

  it('leaves one card one cell short of a column and another already holding a row', (): void => {
    const view = viewOf('player', 5);
    const [mine, winner] = view.cards;
    expect(mine.reach).toEqual([[0, 5, 10, 15, 20]]);
    expect(mine.bingo).toEqual([]);
    expect(mine.marked).toEqual([12, 0, 5, 10, 15]);
    expect(winner.bingo).toEqual([[10, 11, 12, 13, 14]]);
  });
});

describe('the preview scenes', () => {
  it('draws nothing in the lobby and has nothing to reveal', (): void => {
    const view = viewOf('lobby', 5);
    expect(SCENES.lobby(5).state.drawnOrder).toEqual([]);
    expect(view.phase).toBe('Lobby');
    expect(view.wins).toEqual([]);
    expect(view.revealedSeed).toBeNull();
  });

  it('draws a running game without ever repeating a number, at every size', (): void => {
    for (const size of SIZES) {
      const drawn = SCENES.player(size).state.drawnOrder;
      expect(drawn).toHaveLength(23);
      expect(new Set(drawn).size).toBe(23);
      expect(Math.min(...drawn)).toBeGreaterThan(0);
      expect(Math.max(...drawn)).toBeLessThanOrEqual(size * RUN);
    }
  });

  it('leaves the win unreported while the game runs', (): void => {
    const { state } = SCENES.player(5);
    expect(state.drawnOrder).toHaveLength(23);
    expect(state.room?.settings.drawnVisibility).toBe('Full');
    expect(state.view?.wins).toEqual([]);
  });

  it('keeps the draw out of the hidden scene entirely', (): void => {
    const { state } = SCENES['player-hidden'](5);
    expect(state.room?.settings.drawnVisibility).toBe('Hidden');
    expect(state.drawnOrder).toEqual([]);
    expect(state.view?.drawn).toEqual([]);
  });

  it('holds a mark in flight for the manual scene and drops the socket for the offline one', (): void => {
    expect(SCENES['player-manual'](5).state.view?.config.daub).toBe('Manual');
    expect(SCENES['player-manual'](5).state.pending).toEqual([{ cardIx: 0, row: 1, col: 1 }]);
    expect(SCENES['player-offline'](5).state.status).toBe('closed');
    expect(SCENES.player(5).state.status).toBe('open');
  });

  it('finishes the win scene on a shared first place with the seed published', (): void => {
    const view = viewOf('win', 5);
    expect(view.phase).toBe('Finished');
    expect(view.wins).toHaveLength(1);
    expect(view.wins[0].rank).toBe(1);
    expect(view.wins[0].winners).toHaveLength(2);
    expect(view.wins[0].patterns).toEqual([[10, 11, 12, 13, 14]]);
    expect(view.revealedSeed).toHaveLength(64);
  });
});
