import { playerKey } from '@bingo/wrapper/identity';
import { describe, expect, it } from 'vitest';

import { initialUi, uiReducer } from '../../app/room/uiState';

const TARGET = playerKey({ issuer: 'discord', subject: 'me-0002' });

describe('the overlay state', () => {
  it('opens an overlay without moving the panel underneath it', (): void => {
    expect(
      uiReducer(
        {
          ...initialUi,
          panel: 'card',
        },
        {
          type: 'open',
          overlay: {
            kind: 'kick',
            player: TARGET,
          },
        },
      ),
    ).toEqual({
      overlay: {
        kind: 'kick',
        player: TARGET,
      },
      panel: 'card',
    });
  });

  it('dismisses the overlay and leaves the panel where it was', (): void => {
    expect(
      uiReducer(
        {
          overlay: {
            kind: 'close',
          },
          panel: 'roster',
        },
        {
          type: 'dismiss',
        },
      ),
    ).toEqual({
      overlay: null,
      panel: 'roster',
    });
  });

  it('raises the roster sheet as an overlay and closes it the same way as the rest', (): void => {
    const opened = uiReducer(initialUi, {
      type: 'open',
      overlay: {
        kind: 'roster',
      },
    });
    expect(opened).toEqual({
      overlay: {
        kind: 'roster',
      },
      panel: 'board',
    });
    expect(
      uiReducer(opened, {
        type: 'dismiss',
      }),
    ).toEqual(initialUi);
  });

  it('swaps the panel a phone-sized host is reading without closing anything', (): void => {
    const showing = uiReducer(
      {
        overlay: {
          kind: 'close',
        },
        panel: 'board',
      },
      {
        type: 'panel',
        panel: 'card',
      },
    );
    expect(showing).toEqual({
      overlay: {
        kind: 'close',
      },
      panel: 'card',
    });
    expect(initialUi.panel).toBe('board');
    expect(initialUi.overlay).toBeNull();
  });
});
