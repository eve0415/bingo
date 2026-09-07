import type { RoomState } from './connection';
import type { Measure } from './layout';
import type { ProfileLookup } from './profiles';
import type { UiAction, UiState } from './uiState';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Host } from './host';
import { Launch } from './launch';
import { hostLayout, isDense, lobbyLayout, playerLayout } from './layout';
import { Lobby } from './lobby';
import { cardsOf, isHost, noticeOf, visibilityOf } from './model';
import { Player } from './player';
import { Note, Screen } from './screen';
import { Win } from './win';

/** Before the first snapshot there is no room to draw, so the launch keeps counting rather than swapping to a second waiting screen. */
const Waiting = ({ notice }: { notice: string | null }): JSX.Element => <Launch notice={notice} step="room" />;

/** A join the room refused is over, and a screen that goes on counting steps would say the opposite of what happened. */
const Refused = ({ notice }: { notice: string }): JSX.Element => (
  <Screen>
    <Note body={notice} title="参加できませんでした" />
  </Screen>
);

/** One room, four screens, chosen by the phase the engine reports and by whether this player is the one calling numbers. */
export const Board = ({
  state,
  me,
  profiles,
  measure,
  ui,
  onUi,
  onCommand,
}: {
  state: RoomState;
  me: PlayerIdDto;
  profiles: ProfileLookup;
  measure: Measure;
  ui: UiState;
  onUi: (action: UiAction) => void;
  onCommand: (message: ClientMessage) => void;
}): JSX.Element => {
  const notice = noticeOf(state);
  const { view } = state;
  if (view === null) {
    // A closed socket before the first snapshot is a refusal, a kick or an expired room: terminal, and nothing retries it.
    if (notice !== null && state.status === 'closed') return <Refused notice={notice} />;
    // A socket that is merely opening is what the launch already counts, so only a failure is worth repeating as a notice.
    return <Waiting notice={state.status === 'connecting' ? null : notice} />;
  }
  const visibility = visibilityOf(state);
  const host = isHost(view, me);
  // A game the host replaced from the lobby is closed and reopened in one exchange; a finished game with nothing to report has no result to show for it.
  if (view.phase === 'Finished' && (view.wins.length > 0 || state.drawnOrder.length > 0)) {
    return <Win dense={isDense(measure)} host={host} profiles={profiles} notice={notice} onSend={onCommand} players={view.players.length} view={view} />;
  }
  if (view.phase !== 'Running') {
    return (
      <Lobby
        commitment={state.room?.commitment ?? null}
        gameIndex={state.room?.gameIndex ?? 0}
        host={host}
        me={me}
        profiles={profiles}
        notice={notice}
        onSend={onCommand}
        onUi={onUi}
        ui={ui}
        view={view}
        visibility={visibility}
        layout={lobbyLayout(measure)}
      />
    );
  }
  if (host) {
    return (
      <Host
        dense={isDense(measure)}
        drawnOrder={state.drawnOrder}
        layout={hostLayout(measure, view.config.size)}
        me={me}
        profiles={profiles}
        notice={notice}
        onSend={onCommand}
        onUi={onUi}
        pending={state.pending}
        ui={ui}
        view={view}
        visibility={visibility}
      />
    );
  }
  return (
    <Player
      drawnOrder={state.drawnOrder}
      layout={playerLayout(measure, view.config.size, {
        showCall: visibility !== 'Hidden',
        footer: view.config.winDetection === 'Claim' && cardsOf(view, me).length > 0,
      })}
      me={me}
      profiles={profiles}
      notice={notice}
      offline={state.status !== 'open'}
      onSend={onCommand}
      onUi={onUi}
      pending={state.pending}
      ui={ui}
      view={view}
      visibility={visibility}
    />
  );
};
