import type { ActivitySession } from '../discord';
import type { OpenTransport, RoomConnection } from '../room/connection';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';

import { activitySession } from '../discord';
import { Board } from '../room/board';
import { connectRoom, initialRoomState, roomSocketUrl } from '../room/connection';
import { ISSUER } from '../session';

const Joining = (): JSX.Element => <p>Joining the activity…</p>;

const ConnectedRoom = ({ instanceId, roomToken, me }: { instanceId: string; roomToken: string; me: PlayerIdDto }): JSX.Element => {
  const [state, setState] = useState(initialRoomState);
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
  const onCommand = useCallback((message: ClientMessage): void => {
    current.current?.send(message);
  }, []);
  return <Board me={me} onCommand={onCommand} state={state} />;
};

const Session = ({ pending }: { pending: Promise<ActivitySession> }): JSX.Element => {
  const session = use(pending);
  if (session.roomToken === null) return <p>The board runs only inside Discord.</p>;
  const me: PlayerIdDto = {
    issuer: ISSUER,
    subject: session.user.id,
  };
  return (
    <>
      <p>
        {session.user.displayName} joined instance {session.instanceId}
      </p>
      {session.room === null ? null : (
        <p>
          room token: {session.room.detail} ({session.room.status})
        </p>
      )}
      <ConnectedRoom instanceId={session.instanceId} me={me} roomToken={session.roomToken} />
    </>
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

const Failed = ({ error }: { error: Error }): JSX.Element => <p>Could not join the activity: {error.message}</p>;

export const Route = createFileRoute('/')({
  component: Activity,
  errorComponent: Failed,
});
