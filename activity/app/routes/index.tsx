import type { ActivitySession } from '../discord';
import type { OpenTransport, RoomConnection } from '../room/connection';
import type { Measure } from '../room/layout';
import type { PresenceSink } from '../room/presence';
import type { UiAction } from '../room/uiState';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { Suspense, use, useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';

import { activitySession, bootProgress, participantProfiles } from '../discord';
import { Board } from '../room/board';
import { connectRoom, initialRoomState, roomSocketUrl } from '../room/connection';
import { Launch } from '../room/launch';
import { presenceSink } from '../room/presence';
import { Note, Screen } from '../room/screen';
import { initialUi, uiReducer } from '../room/uiState';
import { ISSUER } from '../session';

const Standalone = ({ body, title }: { body: string; title: string }): JSX.Element => (
  <Screen>
    <Note body={body} title={title} />
  </Screen>
);

const Joining = (): JSX.Element => <Launch step={useSyncExternalStore(bootProgress.subscribe, bootProgress.read, bootProgress.read)} />;

/** Discord hands the activity a frame of any shape, and the screens are chosen from what it measures rather than from a device class. */
const useMeasure = (): [Measure, (node: HTMLDivElement | null) => (() => void) | undefined] => {
  // The observer reports only after the first layout, so a seed of the wrong shape would paint one arrangement and swap to another.
  const [measure, setMeasure] = useState<Measure>(() => ({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  }));
  const observe = useCallback((node: HTMLDivElement | null): (() => void) | undefined => {
    if (node === null) return undefined;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setMeasure({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(node);
    return (): void => {
      observer.disconnect();
    };
  }, []);
  return [measure, observe];
};

const ConnectedRoom = ({
  instanceId,
  roomToken,
  me,
  presence,
}: {
  instanceId: string;
  roomToken: string;
  me: PlayerIdDto;
  presence: PresenceSink;
}): JSX.Element => {
  const [state, setState] = useState(initialRoomState);
  const profiles = useSyncExternalStore(participantProfiles.subscribe, participantProfiles.read, participantProfiles.read);
  const [ui, apply] = useReducer(uiReducer, initialUi);
  // An overlay is opened from a control, so closing it has to give the keyboard back to that control rather than to the document.
  const opener = useRef<Element | null>(null);
  const [measure, observe] = useMeasure();
  const current = useRef<RoomConnection | null>(null);
  useEffect((): (() => void) => {
    const open: OpenTransport = handlers => {
      const socket = new WebSocket(roomSocketUrl(globalThis.location.origin, instanceId), roomToken);
      socket.addEventListener('open', (): void => {
        handlers.onOpen();
      });
      socket.addEventListener('message', (event): void => {
        if (typeof event.data === 'string') handlers.onMessage(event.data);
      });
      socket.addEventListener('close', (event): void => {
        handlers.onClose(event.code, event.reason);
      });
      return {
        send: (data): void => {
          socket.send(data);
        },
        close: (): void => {
          socket.close();
        },
      };
    };
    const connection = connectRoom(open, setState);
    current.current = connection;
    return (): void => {
      current.current = null;
      connection.close();
    };
  }, [instanceId, roomToken]);
  const onUi = useCallback((action: UiAction): void => {
    // A card dialogue can lead to a kick confirmation, and the control worth returning to is the one outside both of them.
    if (action.type === 'open') opener.current ??= document.activeElement;
    else if (action.type === 'dismiss') {
      const target = opener.current;
      opener.current = null;
      if (target instanceof HTMLElement) target.focus();
    }
    apply(action);
  }, []);
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
  }, [onUi]);
  /* React applies autoFocus only to form controls, so the surface is focused here; the exit half already restores the opener.
     This follows the overlay rather than whether there is one, because one overlay can open another: a row menu carries no surface,
     so a dialogue raised from inside it would never be focused while the screen behind it had already gone inert. */
  const { overlay } = ui;
  useEffect((): void => {
    if (overlay === null) return;
    const surface = document.querySelector('[data-bingo-surface]');
    if (surface instanceof HTMLElement) surface.focus();
  }, [overlay]);
  // An overlay belongs to the game it was opened over; a close dialogue left standing would otherwise act on the next one.
  const game = state.room?.gameIndex;
  useEffect((): void => {
    apply({
      type: 'dismiss',
    });
  }, [game]);
  // The profile card is a courtesy that follows the room, and the sink decides what is worth telling Discord about.
  useEffect((): void => {
    presence.update(state, me);
  }, [state, me, presence]);
  useEffect((): (() => void) => presence.close, [presence]);
  const onCommand = useCallback((message: ClientMessage): void => {
    current.current?.send(message);
  }, []);
  return (
    <div data-bingo-frame="" ref={observe}>
      <Board measure={measure} me={me} profiles={profiles} onCommand={onCommand} onUi={onUi} state={state} ui={ui} />
    </div>
  );
};

const Session = ({ pending }: { pending: Promise<ActivitySession> }): JSX.Element => {
  const session = use(pending);
  /* The command reports a refusal only by throwing, and the sink swallows it so that a courtesy can never disturb the room.
     Written out here because a card that quietly never appears is otherwise indistinguishable from one the client took and chose not to draw. */
  const [presence] = useState(() =>
    presenceSink(async activity => {
      try {
        return await session.sdk.commands.setActivity({ activity });
      } catch (error) {
        console.warn('bingo: presence refused', activity, error);
        throw error;
      }
    }),
  );
  if (session.roomToken === null) return <Standalone body="Discord のアクティビティとして開いてください。" title="ここでは遊べません" />;
  return (
    <ConnectedRoom
      instanceId={session.instanceId}
      me={{
        issuer: ISSUER,
        subject: session.user.id,
      }}
      presence={presence}
      roomToken={session.roomToken}
    />
  );
};

// The handshake talks to the Discord client over postMessage, so it exists only after hydration.
// It is started here rather than inside Session because a suspending component loses the state that holds its own promise.
const Handshake = (): JSX.Element => {
  const [pending] = useState(activitySession);
  return (
    <Suspense fallback={<Joining />}>
      <Session pending={pending} />
    </Suspense>
  );
};

const Activity = (): JSX.Element => (
  <ClientOnly fallback={<Joining />}>
    <Handshake />
  </ClientOnly>
);

const Failed = ({ error }: { error: Error }): JSX.Element => <Standalone body={error.message} title="参加できませんでした" />;

export const Route = createFileRoute('/')({
  component: Activity,
  errorComponent: Failed,
});
