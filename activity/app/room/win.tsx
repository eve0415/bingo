import type { ProfileLookup } from './profiles';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { playerKey } from '@bingo/wrapper/identity';

import { Button } from './button';
import { BingoCard } from './card';
import { newGameMessage } from './commands';
import { screenEdge } from './layout';
import { cardCells, strikeLines } from './lines';
import { winnerCards, winnerGroups } from './model';
import { nameOf } from './profiles';
import { Notice, Screen, Wordmark } from './screen';

/**
 * The result is the screen: who won, on which line, and the seed that proves the draw was fixed before anyone joined.
 * There is no celebration copy — the strike bar through the completed line is the celebration.
 */
export const Win = ({
  view,
  profiles,
  dense,
  host,
  players,
  notice,
  onSend,
}: {
  view: RoomView;
  profiles: ProfileLookup;
  dense: boolean;
  host: boolean;
  players: number;
  notice: string | null;
  onSend: (message: ClientMessage) => void;
}): JSX.Element => {
  const groups = winnerGroups(view, profiles);
  const cards = winnerCards(view);
  const { size } = view.config;
  const noWin = groups.length === 0;
  return (
    <Screen
      edge={screenEdge(dense)}
      footer={
        <>
          <Notice notice={notice} />
          <div data-bingo-actions="">
            {host ? (
              <Button
                block
                onClick={() => {
                  onSend(newGameMessage(null));
                }}
                size="lg"
                variant="primary"
              >
                もう一回
              </Button>
            ) : null}
          </div>
        </>
      }
      header={<Wordmark players={players} status="終了" />}
    >
      <div data-bingo-result="" tabIndex={0}>
        <div data-bingo-result-head="">
          <span aria-hidden="true" data-bingo-result-bar="" />
          <h2 data-bingo-result-title="">{noWin ? 'ビンゴは出ませんでした' : 'ビンゴ'}</h2>
          <p data-bingo-body="">{noWin ? '次のゲームで続けられます。' : 'おつかれさまでした。'}</p>
        </div>
        <ol data-bingo-winners="">
          {groups.map(group => (
            <li data-bingo-winner="" key={group.rank}>
              <span data-bingo-rank="">{group.rank}位</span>
              <span data-bingo-winner-names="">{group.names}</span>
            </li>
          ))}
        </ol>
        <div data-bingo-result-cards="">
          {cards.map(card => (
            <div data-bingo-result-card="" key={`${playerKey(card.owner)}:${card.cardIx}`}>
              <p data-bingo-label="">{nameOf(card.owner, profiles)}</p>
              <BingoCard cells={cardCells(card, [], null)} flat lines={strikeLines(card.bingo, size)} maxWidth="320px" settled size={size} />
            </div>
          ))}
        </div>
        <p data-bingo-fine="">{view.revealedSeed === null ? 'シードはまもなく公開されます' : `公開されたシード ${view.revealedSeed}`}</p>
      </div>
    </Screen>
  );
};
