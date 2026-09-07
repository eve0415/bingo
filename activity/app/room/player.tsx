import type { PendingMark } from './connection';
import type { PlayerLayout } from './layout';
import type { Visibility } from './model';
import type { ProfileLookup } from './profiles';
import type { UiAction, UiState } from './uiState';
import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Button } from './button';
import { CalledNumber } from './call';
import { BingoCard } from './card';
import { cellMessage, claimMessage } from './commands';
import { screenEdge } from './layout';
import { cardCells, isReach, strikeLines } from './lines';
import { calledEntries, cardsOf, pendingFor, progressLabel, rosterMembers } from './model';
import { RosterRow } from './roster';
import { Note, Notice, ReachNote, Screen, Sheet, Wordmark } from './screen';

const HiddenNote = (): JSX.Element => (
  <div data-bingo-hidden-note="">
    <span aria-hidden="true" data-bingo-hidden-mark="" />
    <span>番号は非公開です。カードだけを見て遊びます</span>
  </div>
);

/**
 * The player screen is the card and the number being called, and nothing else competes with them.
 * Every changing part sits in space reserved for its largest occupant, so a draw arriving mid-tap cannot move the cell under a thumb.
 */
export const Player = ({
  view,
  me,
  profiles,
  visibility,
  drawnOrder,
  pending,
  layout,
  offline,
  notice,
  ui,
  onUi,
  onSend,
}: {
  view: RoomView;
  me: PlayerIdDto;
  profiles: ProfileLookup;
  visibility: Visibility;
  drawnOrder: readonly number[];
  pending: readonly PendingMark[];
  layout: PlayerLayout;
  offline: boolean;
  notice: string | null;
  ui: UiState;
  onUi: (action: UiAction) => void;
  onSend: (message: ClientMessage) => void;
}): JSX.Element => {
  const { size } = view.config;
  const cards = cardsOf(view, me);
  const { latest, history } = calledEntries(drawnOrder, size);
  const members = rosterMembers(view, me, profiles);
  const manual = view.config.daub === 'Manual' && view.phase === 'Running' && !offline;
  // A card marked by hand answers the tap rather than the draw, and a hidden call has no reel to wait for.
  const rolling = latest === null || view.config.daub === 'Manual' || !layout.showCall ? null : latest.value;
  const beside = layout.arrangement === 'row';
  // Claim validates the card it is given, so it has to be the one holding the completed line rather than merely the first.
  const claimable = cards.find(card => card.bingo.length > 0) ?? cards[0];
  const tapFor =
    (card: CardViewDto) =>
    (index: number): void => {
      onSend(cellMessage(card.cardIx, index, size, card.marked.includes(index)));
    };
  const roster = (
    <Button
      onClick={() => {
        onUi({
          type: 'open',
          overlay: {
            kind: 'roster',
          },
        });
      }}
      variant="ghost"
    >
      参加者 {members.length}
    </Button>
  );
  const reach = cards.some(card => isReach(card));
  const rosterList = (
    <div data-bingo-roster="">
      {members.map(member => (
        <RosterRow entry={member.entry} key={member.entry.key} />
      ))}
    </div>
  );
  return (
    <Screen
      edge={screenEdge(layout.dense)}
      footer={
        layout.footer ? (
          <div data-bingo-actions="">
            <Button
              block
              disabled={offline}
              onClick={() => {
                onSend(claimMessage(claimable.cardIx));
              }}
              size="lg"
              variant="primary"
            >
              ビンゴを宣言
            </Button>
          </div>
        ) : null
      }
      header={
        beside ? null : (
          <>
            <Wordmark players={members.length} status={offline ? '接続が切れました' : '接続中'} />
            {layout.arrangement === 'desk' ? null : roster}
          </>
        )
      }
      overlay={
        ui.overlay?.kind === 'roster' ? (
          <Sheet
            onDismiss={() => {
              onUi({
                type: 'dismiss',
              });
            }}
            title={`参加者 · ${members.length}人`}
          >
            {rosterList}
          </Sheet>
        ) : null
      }
    >
      <div data-arrangement={layout.arrangement} data-bingo-play="" data-tight={layout.tight}>
        <div data-bingo-play-call="">
          {layout.showCall ? (
            <CalledNumber
              history={layout.showHistory ? history : undefined}
              latest={latest}
              progress={progressLabel(drawnOrder.length, size, visibility)}
              variant={layout.callVariant}
            />
          ) : (
            <HiddenNote />
          )}
          <ReachNote reach={reach} />
          {beside ? (
            <>
              <Notice notice={notice} />
              {roster}
            </>
          ) : null}
        </div>
        <div
          data-bingo-play-card=""
          data-many={cards.length > 1}
          style={{
            maxWidth: `${layout.cardMax}px`,
          }}
        >
          {cards.length === 0 ? (
            <Note body="このゲームにはカードがありません。次のゲームから参加できます。" title="観戦中" />
          ) : (
            cards.map(card => (
              <BingoCard
                cells={cardCells(card, pendingFor(pending, card.cardIx, size), rolling)}
                key={card.cardIx}
                lines={strikeLines(card.bingo, size)}
                maxWidth="100%"
                onTap={manual ? tapFor(card) : undefined}
                size={size}
              />
            ))
          )}
          {beside ? null : <Notice notice={notice} />}
        </div>
        {layout.arrangement === 'desk' ? (
          <div data-bingo-rail="">
            <h2 data-bingo-label="">参加者 · {members.length}人</h2>
            {rosterList}
          </div>
        ) : null}
      </div>
    </Screen>
  );
};
