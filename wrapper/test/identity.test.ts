import { describe, expect, it } from 'vitest';

import { playerKey, samePlayer } from '../src/identity';

const PLAYER = {
  issuer: 'discord',
  subject: 'player-1',
};

describe('player identity', () => {
  it('requires both identity components to match', (): void => {
    expect(samePlayer(PLAYER, { ...PLAYER })).toBe(true);
    expect(samePlayer(PLAYER, { issuer: 'guest', subject: PLAYER.subject })).toBe(false);
    expect(samePlayer(PLAYER, { issuer: PLAYER.issuer, subject: 'player-2' })).toBe(false);
  });

  it('builds a stable composite key', (): void => {
    expect(playerKey(PLAYER)).toBe('discord\u0000player-1');
  });
});
