import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { DaubDto } from '@bingo/wasm/DaubDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { WinLimitDto } from '@bingo/wasm/WinLimitDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { RoomSettings } from '@bingo/wrapper/settings';

export const commandMessage = (command: CommandDto): ClientMessage => ({
  type: 'command',
  command,
});

/**
 * Taking a seat and giving one up, which are the same decision read in two directions.
 * Every screen offers it, because being in the room and playing the game are separate facts and either can change while the other holds.
 */
export const seatMessage = (seated: boolean): ClientMessage => commandMessage(seated ? 'Leave' : 'Join');

export const cellMessage = (cardIx: number, index: number, size: number, marked: boolean): ClientMessage => {
  const position = {
    cardIx,
    row: Math.floor(index / size),
    col: index % size,
  };
  return commandMessage(marked ? { Unmark: position } : { Mark: position });
};

export const claimMessage = (cardIx: number): ClientMessage =>
  commandMessage({
    Claim: {
      cardIx,
    },
  });

export const kickMessage = (target: PlayerIdDto): ClientMessage =>
  commandMessage({
    Kick: {
      target,
    },
  });

/** The room follows its host, so handing the role over is one command rather than a rebuild of the room around a new one. */
export const transferHostMessage = (target: PlayerIdDto): ClientMessage =>
  commandMessage({
    TransferHost: {
      target,
    },
  });

/**
 * Patterns are cell positions, so they are only valid for the size that produced them.
 * An empty list asks the engine for the rows, columns and diagonals of whatever size is being started, which is the only shape this room offers.
 */
export const newGameMessage = (config: ConfigDto | null): ClientMessage => ({
  type: 'newGame',
  config: config === null ? null : { ...config, patterns: [] },
});

export const settingsMessage = (settings: Partial<RoomSettings>): ClientMessage => ({
  type: 'settings',
  settings,
});

export const sizeMessage = (config: ConfigDto, size: number): ClientMessage =>
  newGameMessage({
    ...config,
    size,
  });

export const daubMessage = (config: ConfigDto, daub: DaubDto): ClientMessage =>
  newGameMessage({
    ...config,
    daub,
  });

export const winLimitMessage = (config: ConfigDto, winLimit: WinLimitDto): ClientMessage =>
  newGameMessage({
    ...config,
    winLimit,
  });
