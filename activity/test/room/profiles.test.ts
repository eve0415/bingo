import { describe, expect, it } from 'vitest';

import { initialOf, nameOf, seedOf } from '../../app/room/profiles';

import { HOST, ME, OTHER, PROFILES } from './fixture';

describe('player names', () => {
  it('prefers the name the instance reported', (): void => {
    expect(nameOf(HOST, PROFILES)).toBe('ホストさん');
  });

  it('falls back to a subject tail for a player the instance did not name', (): void => {
    expect(nameOf(OTHER, PROFILES)).toBe('プレイヤー 0003');
  });
});

describe('avatar seeds', () => {
  it('gives one player the same colour every time and two players different ones', (): void => {
    expect(seedOf(HOST)).toBe(seedOf({ ...HOST }));
    expect(seedOf(HOST)).not.toBe(seedOf(ME));
    expect(seedOf(ME)).toBeGreaterThanOrEqual(0);
    expect(seedOf(ME)).toBeLessThan(997);
  });
});

describe('avatar initials', () => {
  it('takes the first letter of a plain name', (): void => {
    expect(initialOf('ホストさん')).toBe('ホ');
  });

  it('takes a whole emoji rather than half of it', (): void => {
    expect(initialOf('🎲ぼく')).toBe('🎲');
  });

  it('keeps a joined sequence together', (): void => {
    expect(initialOf('👨‍👩‍👧です')).toBe('👨‍👩‍👧');
  });
});
