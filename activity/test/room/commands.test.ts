import { describe, expect, it } from 'vitest';

import {
  cellMessage,
  claimMessage,
  commandMessage,
  daubMessage,
  kickMessage,
  newGameMessage,
  seatMessage,
  settingsMessage,
  sizeMessage,
  transferHostMessage,
  winLimitMessage,
} from '../../app/room/commands';

import { OTHER, config } from './fixture';

describe('room commands', () => {
  it('wraps every always-visible control', (): void => {
    expect([
      commandMessage('Join'),
      commandMessage('Leave'),
      commandMessage('Start'),
      commandMessage('Draw'),
      commandMessage('Undo'),
      commandMessage('Close'),
    ]).toEqual([
      { type: 'command', command: 'Join' },
      { type: 'command', command: 'Leave' },
      { type: 'command', command: 'Start' },
      { type: 'command', command: 'Draw' },
      { type: 'command', command: 'Undo' },
      { type: 'command', command: 'Close' },
    ]);
  });

  it('reads the seat control in both directions', (): void => {
    expect([seatMessage(true), seatMessage(false)]).toEqual([
      { type: 'command', command: 'Leave' },
      { type: 'command', command: 'Join' },
    ]);
  });

  it('turns a cell position into a mark or an unmark', (): void => {
    expect(cellMessage(3, 5, 4, false)).toEqual({
      type: 'command',
      command: {
        Mark: {
          cardIx: 3,
          row: 1,
          col: 1,
        },
      },
    });
    expect(cellMessage(3, 6, 4, true)).toEqual({
      type: 'command',
      command: {
        Unmark: {
          cardIx: 3,
          row: 1,
          col: 2,
        },
      },
    });
  });

  it('hands the room to another player', (): void => {
    expect(transferHostMessage(OTHER)).toEqual({
      type: 'command',
      command: {
        TransferHost: {
          target: OTHER,
        },
      },
    });
  });

  it('claims a card and removes a player', (): void => {
    expect(claimMessage(3)).toEqual({
      type: 'command',
      command: {
        Claim: {
          cardIx: 3,
        },
      },
    });
    expect(kickMessage(OTHER)).toEqual({
      type: 'command',
      command: {
        Kick: {
          target: OTHER,
        },
      },
    });
  });
});

describe('new game messages', () => {
  it('leaves the config to the room when none is chosen', (): void => {
    expect(newGameMessage(null)).toEqual({
      type: 'newGame',
      config: null,
    });
  });

  it('drops the patterns of the previous size so the engine derives its own', (): void => {
    expect(
      newGameMessage({
        ...config(),
        patterns: [[0, 1, 2, 3, 4]],
      }),
    ).toEqual({
      type: 'newGame',
      config: {
        ...config(),
        patterns: [],
      },
    });
  });

  it('changes one setting at a time through a new game', (): void => {
    expect(sizeMessage(config(), 7)).toEqual({
      type: 'newGame',
      config: {
        ...config(),
        size: 7,
        patterns: [],
      },
    });
    expect(daubMessage(config(), 'Auto')).toEqual({
      type: 'newGame',
      config: {
        ...config(),
        daub: 'Auto',
        patterns: [],
      },
    });
    expect(winLimitMessage(config(), { Count: 3 })).toEqual({
      type: 'newGame',
      config: {
        ...config(),
        winLimit: {
          Count: 3,
        },
        patterns: [],
      },
    });
    expect(winLimitMessage(config(), 'FirstOnly')).toEqual({
      type: 'newGame',
      config: {
        ...config(),
        winLimit: 'FirstOnly',
        patterns: [],
      },
    });
  });
});

describe('room settings messages', () => {
  it('sends only the settings that changed', (): void => {
    expect(
      settingsMessage({
        drawnVisibility: 'Hidden',
      }),
    ).toEqual({
      type: 'settings',
      settings: {
        drawnVisibility: 'Hidden',
      },
    });
  });
});
