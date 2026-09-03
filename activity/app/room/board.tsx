import type { RoomState } from './connection';
import type { Measure } from './layout';
import type { NameLookup } from './names';
import type { UiAction, UiState } from './uiState';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Host } from './host';
import { hostLayout, isDense, lobbyColumns, playerLayout } from './layout';
import { Lobby } from './lobby';
import { cardsOf, isHost, noticeOf, visibilityOf } from './model';
import { Player } from './player';
import { Note, Screen, Wordmark } from './screen';
import { Win } from './win';

/** Before the first snapshot there is no room to draw, so the screen says what it is waiting for rather than showing an empty board. */
const Waiting = ({ notice }: { notice: string | null }): JSX.Element => (
  <Screen header={<Wordmark players={0} status="接続しています" />}>
    <Note body={notice ?? 'まもなく参加できます。'} title="部屋につないでいます" />
  </Screen>
);

/** One room, four screens, chosen by the phase the engine reports and by whether this player is the one calling numbers. */
export const Board = ({
  state,
  me,
  names,
  measure,
  ui,
  onUi,
  onCommand,
}: {
  state: RoomState;
  me: PlayerIdDto;
  names: NameLookup;
  measure: Measure;
  ui: UiState;
  onUi: (action: UiAction) => void;
  onCommand: (message: ClientMessage) => void;
}): JSX.Element => {
  const notice = noticeOf(state);
  const { view } = state;
  if (view === null) return <Waiting notice={notice} />;
  const visibility = visibilityOf(state);
  const host = isHost(view, me);
  // A game the host replaced from the lobby is closed and reopened in one exchange; a finished game with nothing to report has no result to show for it.
  if (view.phase === 'Finished' && (view.wins.length > 0 || state.drawnOrder.length > 0)) {
    return <Win dense={isDense(measure)} host={host} names={names} notice={notice} onSend={onCommand} players={view.players.length} view={view} />;
  }
  if (view.phase !== 'Running') {
    return (
      <Lobby
        commitment={state.room?.commitment ?? null}
        gameIndex={state.room?.gameIndex ?? 0}
        host={host}
        me={me}
        names={names}
        notice={notice}
        onSend={onCommand}
        view={view}
        visibility={visibility}
        columns={lobbyColumns(measure)}
        dense={isDense(measure)}
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
        names={names}
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
      names={names}
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
