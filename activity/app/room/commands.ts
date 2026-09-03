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
