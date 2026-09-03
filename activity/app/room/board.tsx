import type { RoomState } from './connection';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { playerKey, samePlayer } from '@bingo/wrapper/identity';

import { cellMessage, claimMessage, commandMessage, newGameMessage } from './commands';

const playerName = (player: PlayerIdDto): string => `${player.issuer}:${player.subject}`;
const eventSummary = (event: EventDto): { name: string; seq: number } => {
  if ('PlayerJoined' in event) return { name: 'PlayerJoined', seq: event.PlayerJoined.seq };
  if ('PlayerLeft' in event) return { name: 'PlayerLeft', seq: event.PlayerLeft.seq };
  if ('MarkPlaced' in event) return { name: 'MarkPlaced', seq: event.MarkPlaced.seq };
  if ('MarkRemoved' in event) return { name: 'MarkRemoved', seq: event.MarkRemoved.seq };
  if ('BingoClaimed' in event) return { name: 'BingoClaimed', seq: event.BingoClaimed.seq };
  if ('GameStarted' in event) return { name: 'GameStarted', seq: event.GameStarted.seq };
  if ('NumberDrawn' in event) return { name: 'NumberDrawn', seq: event.NumberDrawn.seq };
  if ('DrawUndone' in event) return { name: 'DrawUndone', seq: event.DrawUndone.seq };
  if ('PlayerKicked' in event) return { name: 'PlayerKicked', seq: event.PlayerKicked.seq };
  if ('HostTransferred' in event) return { name: 'HostTransferred', seq: event.HostTransferred.seq };
  if ('GameClosed' in event) return { name: 'GameClosed', seq: event.GameClosed.seq };
  return { name: 'WinRecognized', seq: event.WinRecognized.seq };
};

export const Board = ({ state, me, onCommand }: { state: RoomState; me: PlayerIdDto; onCommand: (message: ClientMessage) => void }): JSX.Element => {
  const { view } = state;
  const controlsDisabled = state.status !== 'open';
  const failureLabel = state.failure?.origin === 'room' ? 'Room-reported failure' : 'Client failure';
  return (
    <main>
      <h1>Bingo room</h1>
      <p>
        Connection: <strong>{state.status}</strong>
      </p>
      {state.closure === null ? null : (
        <p>
          Socket closed with code {state.closure.code}: {state.closure.reason}
        </p>
      )}
      {state.failure === null ? null : (
        <p>
          {failureLabel}: <code>{state.failure.code}</code>; detail: {state.failure.detail ?? 'none'}
        </p>
      )}

      {state.room === null ? (
        <p>Room details are not available yet.</p>
      ) : (
        <dl>
          <dt>Room</dt>
          <dd>{state.room.roomId}</dd>
          <dt>Game index</dt>
          <dd>{state.room.gameIndex}</dd>
        </dl>
      )}

      {view === null ? (
        <p>Waiting for the first room snapshot…</p>
      ) : (
        <>
          <dl>
            <dt>Phase</dt>
            <dd>{view.phase}</dd>
            <dt>Host</dt>
            <dd>{playerName(view.host)}</dd>
          </dl>

          <section>
            <h2>Players</h2>
            <ul>
              {view.players.map(player => (
                <li key={playerKey(player)}>
                  {playerName(player)}
                  {samePlayer(player, me) ? ' (you)' : ''}
                  {samePlayer(player, view.host) ? ' (host)' : ''}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>Drawn numbers</h2>
            <ol>
              {state.drawnOrder.map((number, index) => (
                <li key={`${index}:${number}`}>{index === state.drawnOrder.length - 1 ? <strong>{number} (latest)</strong> : number}</li>
              ))}
            </ol>
          </section>

          <section>
            <h2>Cards</h2>
            {view.cards.map(card => {
              const owned = samePlayer(card.owner, me);
              const markedPositions = new Set(card.marked);
              // Card commands carry no owner, so acting on another player's card would target the actor's card at the same index.
              return (
                <article key={`${playerKey(card.owner)}:${card.cardIx}`}>
                  <h3>
                    Card {card.cardIx} for {playerName(card.owner)}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${view.config.size}, minmax(0, 1fr))` }}>
                    {card.cells.map((number, index) => {
                      const marked = markedPositions.has(index);
                      if (!owned) return <span key={index}>{marked ? <mark>{number}</mark> : number}</span>;
                      return (
                        <button
                          aria-label={`${marked ? 'Unmark' : 'Mark'} ${number}`}
                          aria-pressed={marked}
                          disabled={controlsDisabled}
                          key={index}
                          onClick={() => {
                            onCommand(cellMessage(card.cardIx, index, view.config.size, marked));
                          }}
                          type="button"
                        >
                          {marked ? <mark>{number}</mark> : number}
                        </button>
                      );
                    })}
                  </div>
                  {owned ? (
                    <button
                      disabled={controlsDisabled}
                      onClick={() => {
                        onCommand(claimMessage(card.cardIx));
                      }}
                      type="button"
                    >
                      Claim
                    </button>
                  ) : null}
                </article>
              );
            })}
          </section>

          <section>
            <h2>Recognized wins</h2>
            <ol>
              {view.wins.map((win, index) => (
                <li key={`${win.rank}:${win.atSeq}:${index}`}>
                  Rank {win.rank} at sequence {win.atSeq}: {win.winners.map(playerName).join(', ')}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <section>
        <h2>Recent events</h2>
        <ol>
          {state.log.map((event, index) => {
            const summary = eventSummary(event);
            return (
              <li key={`${summary.name}:${summary.seq}:${index}`}>
                {summary.name} at sequence {summary.seq}
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2>Controls</h2>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(commandMessage('Join'));
          }}
          type="button"
        >
          Join
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(commandMessage('Leave'));
          }}
          type="button"
        >
          Leave
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(commandMessage('Start'));
          }}
          type="button"
        >
          Start
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(commandMessage('Draw'));
          }}
          type="button"
        >
          Draw
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(commandMessage('Undo'));
          }}
          type="button"
        >
          Undo
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(commandMessage('Close'));
          }}
          type="button"
        >
          Close
        </button>
        <button
          disabled={controlsDisabled}
          onClick={() => {
            onCommand(newGameMessage());
          }}
          type="button"
        >
          New game
        </button>
      </section>
    </main>
  );
};
