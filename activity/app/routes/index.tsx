import type { ActivitySession } from '../discord';
import type { JSX } from 'react';

import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { Suspense, use, useState } from 'react';

import { activitySession } from '../discord';

const Joining = (): JSX.Element => <p>Joining the activity…</p>;

const Session = ({ pending }: { pending: Promise<ActivitySession> }): JSX.Element => {
  const session = use(pending);
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

const Board = (): JSX.Element => (
  <ClientOnly fallback={<Joining />}>
    <Handshake />
  </ClientOnly>
);

const Failed = ({ error }: { error: Error }): JSX.Element => <p>Could not join the activity: {error.message}</p>;

export const Route = createFileRoute('/')({
  component: Board,
  errorComponent: Failed,
});
