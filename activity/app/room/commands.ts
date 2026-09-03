import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';

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

export const newGameMessage = (): ClientMessage => ({
  type: 'newGame',
  config: null,
});
