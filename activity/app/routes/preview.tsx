import type { Scene } from '../preview/fixtures';
import type { JSX } from 'react';

import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { useEffect, useReducer, useSyncExternalStore } from 'react';

import { NAMES, SCENES, SIZES, isScene } from '../preview/fixtures';
import { Board } from '../room/board';
import { Screen } from '../room/screen';
import { initialUi, uiReducer } from '../room/uiState';

const noop = (): void => {
  // Preview screens are fixtures: their controls render and focus, but nothing is sent anywhere.
};

const subscribe = (listener: () => void): (() => void) => {
  globalThis.addEventListener('resize', listener);
  return (): void => {
    globalThis.removeEventListener('resize', listener);
  };
};

const Gallery = (): JSX.Element => (
  <Screen>
    <div data-bingo-note="">
      <p data-bingo-note-title="">Preview</p>
      {Object.keys(SCENES).map(scene => (
        <p data-bingo-body="" key={scene}>
          {SIZES.map(size => (
            <a href={`/preview?scene=${scene}&size=${size}`} key={size} style={{ marginRight: 12 }}>
              {scene} {size}×{size}
            </a>
          ))}
        </p>
      ))}
    </div>
  </Screen>
);

const Fixture = ({ scene, size }: { scene: Scene; size: number }): JSX.Element => {
  const [ui, onUi] = useReducer(uiReducer, initialUi);
  useEffect((): (() => void) => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      onUi({
        type: 'dismiss',
      });
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  const open = ui.overlay !== null;
  useEffect((): void => {
    if (!open) return;
    const surface = document.querySelector('[data-bingo-surface]');
    if (surface instanceof HTMLElement) surface.focus();
  }, [open]);
  const width = useSyncExternalStore(
    subscribe,
    () => globalThis.innerWidth,
    () => 375,
  );
  const height = useSyncExternalStore(
    subscribe,
    () => globalThis.innerHeight,
    () => 812,
  );
  const fixture = SCENES[scene](size);
  return (
    <Board
      me={fixture.me}
      measure={{
        width,
        height,
      }}
      names={NAMES}
      onCommand={noop}
      onUi={onUi}
      state={fixture.state}
      ui={ui}
    />
  );
};

/** Fixtures for the screens, which the Discord handshake makes unreachable outside a real activity. The whole gallery is dropped from a production build. */
const Stage = (): JSX.Element => {
  const query = new URLSearchParams(globalThis.location.search);
  const scene = query.get('scene') ?? '';
  const size = Number(query.get('size'));
  return isScene(scene) ? <Fixture scene={scene} size={SIZES.includes(size) ? size : 5} /> : <Gallery />;
};

const Preview = (): JSX.Element =>
  import.meta.env.DEV ? (
    <ClientOnly fallback={<Gallery />}>
      <Stage />
    </ClientOnly>
  ) : (
    <Screen>{null}</Screen>
  );

export const Route = createFileRoute('/preview')({
  component: Preview,
});
