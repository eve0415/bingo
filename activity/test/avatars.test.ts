import type { AvatarSource } from '../app/avatars';

import { describe, expect, it } from 'vitest';

import { avatarUrl, mergeServerAvatars } from '../app/avatars';

const CDN = 'https://cdn.discordapp.com';
const SNOWFLAKE = '1181199416875556937';
const GUILD = '1181199416875556930';

const source = (overrides: Partial<AvatarSource> = {}): AvatarSource => ({
  id: SNOWFLAKE,
  avatar: null,
  discriminator: '0',
  guildId: null,
  guildAvatar: null,
  ...overrides,
});

describe('the picture shown for a person', () => {
  it('prefers the one they set for this server', (): void => {
    const url = avatarUrl(
      source({
        avatar: 'account-hash',
        guildId: '999',
        guildAvatar: 'server-hash',
      }),
    );
    expect(url).toBe(`${CDN}/guilds/999/users/${SNOWFLAKE}/avatars/server-hash.png?size=128`);
  });

  it('falls back to their account picture when this server has none', (): void => {
    expect(
      avatarUrl(
        source({
          avatar: 'account-hash',
          guildId: '999',
        }),
      ),
    ).toBe(`${CDN}/avatars/${SNOWFLAKE}/account-hash.png?size=128`);
  });

  it('ignores a server picture outside a server', (): void => {
    expect(
      avatarUrl(
        source({
          avatar: 'account-hash',
          guildAvatar: 'server-hash',
        }),
      ),
    ).toBe(`${CDN}/avatars/${SNOWFLAKE}/account-hash.png?size=128`);
  });

  it('asks for an animated avatar as a still', (): void => {
    expect(
      avatarUrl(
        source({
          avatar: 'a_animated-hash',
        }),
      ),
    ).toBe(`${CDN}/avatars/${SNOWFLAKE}/a_animated-hash.png?size=128`);
  });
});

describe('the blank picture Discord draws', () => {
  it('comes from the snowflake for an account on the new username system', (): void => {
    expect(avatarUrl(source())).toBe(`${CDN}/embed/avatars/5.png`);
  });

  it('comes from the discriminator for an account on the legacy one', (): void => {
    expect(
      avatarUrl(
        source({
          discriminator: '2843',
        }),
      ),
    ).toBe(`${CDN}/embed/avatars/3.png`);
  });

  it('settles on the first one for an id the development mock fabricated', (): void => {
    expect(
      avatarUrl(
        source({
          id: 'mock-user',
        }),
      ),
    ).toBe(`${CDN}/embed/avatars/0.png`);
  });

  it('settles on the first one for a discriminator that is not a number', (): void => {
    expect(
      avatarUrl(
        source({
          id: 'mock-user',
          discriminator: 'none',
        }),
      ),
    ).toBe(`${CDN}/embed/avatars/0.png`);
  });
});

describe('what is known after an answer arrives', () => {
  const known = new Map([
    ['player-1', 'first-hash'],
    ['player-2', 'second-hash'],
  ]);

  it('takes a complete answer as the whole truth, so a picture somebody removed stops being shown', () => {
    expect(mergeServerAvatars(known, { guildId: GUILD, avatars: new Map([['player-1', 'first-hash']]), complete: true })).toEqual(
      new Map([['player-1', 'first-hash']]),
    );
  });

  it('lays an incomplete answer over what is known, so a member Discord would not talk about keeps the picture already found', () => {
    expect(mergeServerAvatars(known, { guildId: GUILD, avatars: new Map([['player-1', 'newer-hash']]), complete: false })).toEqual(
      new Map([
        ['player-1', 'newer-hash'],
        ['player-2', 'second-hash'],
      ]),
    );
  });
});
