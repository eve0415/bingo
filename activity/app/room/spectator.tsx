import type { Columns, HostLayout } from './layout';
import type { RosterMember, Visibility } from './model';
import type { ProfileLookup } from './profiles';
import type { PanelTab } from './screen';
import type { Panel, UiAction, UiState } from './uiState';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Button } from './button';
import { CalledNumber } from './call';
import { BingoCard } from './card';
import { StatusChip } from './chip';
import { seatMessage } from './commands';
import { Flashboard } from './flashboard';
import { screenEdge } from './layout';
import { cardCells, strikeLines } from './lines';
import { calledEntries, overlayMember, progressLabel, rosterMembers, seatLabel } from './model';
import { RosterRow } from './roster';
import { Dialog, Notice, Screen, Tabs, Wordmark } from './screen';

/** Two panels rather than the host's three: a watcher has no card of its own for the third to hold. */
const watcherPanels = (players: number): readonly PanelTab[] => [
  {
    panel: 'board',
    label: '盤面',
  },
  {
    panel: 'roster',
    label: '参加者',
    count: players,
  },
];

/** The same dialogue the host opens on a roster row, without the one control a watcher has no business having. */
const CardDialog = ({ dismiss, member, size }: { dismiss: () => void; member: RosterMember; size: number }): JSX.Element => (
  <Dialog
    actions={
      <Button onClick={dismiss} variant="paper">
        閉じる
      </Button>
    }
    aside={<StatusChip status={member.entry.status} surface="paper" />}
    onDismiss={dismiss}
    title={`${member.entry.name}のカード`}
  >
    {member.entry.marks === null ? null : (
      <p data-bingo-body="">
        マーク {member.entry.marks.marked} / {member.entry.marks.total}
      </p>
    )}
    {member.cards.map(card => (
      <BingoCard cells={cardCells(card, [], null)} flat key={card.cardIx} lines={strikeLines(card.bingo, size)} maxWidth="100%" size={size} />
    ))}
  </Dialog>
);

/**
 * The screen for somebody in the room without a card: the number being called, the board it is crossed off on, and the roster — with every card one tap behind it.
 * What there is to watch is other people's cards, so this is the caller's view of the game rather than a player's with nothing in it.
 * It takes the host's frame budget because it holds the same panels in the same arrangements, minus the draw controls and minus a card of its own.
 */
export const Spectator = ({
  view,
  me,
  profiles,
  visibility,
  drawnOrder,
  dense,
  layout,
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
  dense: boolean;
  layout: HostLayout;
  notice: string | null;
  ui: UiState;
  onUi: (action: UiAction) => void;
  onSend: (message: ClientMessage) => void;
}): JSX.Element => {
  const { size } = view.config;
  const { history, latest } = calledEntries(drawnOrder, size);
  const members = rosterMembers(view, me, profiles);
  const progress = progressLabel(drawnOrder.length, size, visibility);
  const reaching = members.filter(member => member.entry.status === 'reach').length;
  const bingoing = members.filter(member => member.entry.status === 'bingo').length;
  const hero = layout.callVariant === 'hero';
  // A room that restricts the draw blanks every mark on somebody else's card, and the marks are the whole of what a watcher is here to read.
  const readable = visibility === 'Full';
  const opened = overlayMember(ui.overlay, members, ['card']);
  const dismiss = (): void => {
    onUi({
      type: 'dismiss',
    });
  };
  const tallies = `参加者 ${members.length}人 · リーチ ${reaching} · ビンゴ ${bingoing}`;
  const call = (
    <>
      <CalledNumber
        history={hero ? history : undefined}
        idle={readable ? 'ホストが番号を引くと、ここに履歴が並びます' : undefined}
        latest={latest}
        progress={progress}
        recent={hero ? undefined : history.slice(0, dense ? 2 : 3)}
        variant={layout.callVariant}
      />
      <p data-bingo-label="">{tallies}</p>
      <Notice notice={notice} />
    </>
  );
  const board = (
    <>
      <div data-bingo-head="">
        <h2 data-bingo-label="">呼ばれた番号</h2>
        <span data-bingo-count="">{progress}</span>
      </div>
      <div data-bingo-flash-block="">
        <Flashboard drawnOrder={drawnOrder} size={size} />
      </div>
    </>
  );
  const roster = (
    <>
      <div data-bingo-head="">
        <h2 data-bingo-label="">
          参加者 <span data-bingo-count="">{members.length}人</span>
        </h2>
        <span data-bingo-tallies="">
          <span data-bingo-tally="" data-status="reach">
            <span aria-hidden="true">◆</span> リーチ {reaching}
          </span>
          <span data-bingo-tally="" data-status="bingo">
            <span aria-hidden="true">★</span> ビンゴ {bingoing}
          </span>
        </span>
      </div>
      <div data-bingo-roster="">
        {members.map(member => (
          <RosterRow
            entry={member.entry}
            key={member.entry.key}
            onOpen={
              // Under a restriction the card is there but every mark on it is blanked, so there is nothing behind the row worth taking the screen for.
              !readable || member.cards.length === 0
                ? undefined
                : (): void => {
                    onUi({
                      type: 'open',
                      overlay: {
                        kind: 'card',
                        player: member.entry.key,
                      },
                    });
                  }
            }
          />
        ))}
      </div>
    </>
  );
  // The third panel is the roster as well, because a watcher switching to a card it does not have would find the panel empty.
  const PANEL_CONTENT = {
    board,
    roster,
    card: roster,
  } satisfies Record<Panel, JSX.Element>;
  const switched = (
    <div data-bingo-columns="" data-columns={layout.columns}>
      <div data-bingo-column="">{call}</div>
      <div data-bingo-switch="">
        <Tabs
          // The shell owns the panel, so a player who had their card open and then lost their seat arrives here on one this screen does not offer.
          current={ui.panel === 'board' ? 'board' : 'roster'}
          panels={watcherPanels(members.length)}
          onPanel={(panel): void => {
            onUi({
              type: 'panel',
              panel,
            });
          }}
        />
        {/* The panels are all divs, so the region they scroll has to be reachable in its own right. */}
        <div data-bingo-panel="" tabIndex={0}>
          {PANEL_CONTENT[ui.panel]}
        </div>
      </div>
    </div>
  );
  const split = (
    <div data-bingo-columns="" data-columns="split">
      <div data-bingo-column="">
        {call}
        {board}
      </div>
      <div data-bingo-column="">{roster}</div>
    </div>
  );
  // The width the host spends on a third column is spent here on the board, which is the object this screen exists to show.
  const bench = (
    <div data-bingo-columns="" data-columns="bench">
      <div data-bingo-column="">
        {call}
        {board}
      </div>
      <div data-bingo-column="">{roster}</div>
    </div>
  );
  const ARRANGEMENTS = {
    one: switched,
    beside: switched,
    split,
    desk: bench,
  } satisfies Record<Columns, JSX.Element>;
  // Discord has shrunk the activity to a corner of the call. The number and who is close are what still fit, and a watcher has nothing to act on.
  const pip = (
    <div data-bingo-pip="">
      <CalledNumber latest={latest} progress={progress} variant="compact" />
      <p data-bingo-pip-summary="">{tallies}</p>
      <Notice notice={notice} />
    </div>
  );
  return (
    <Screen
      edge={screenEdge(dense)}
      header={
        <>
          <Wordmark players={members.length} status="観戦中" />
          <Button
            onClick={() => {
              onSend(seatMessage(false));
            }}
            variant="ghost"
          >
            {seatLabel(false)}
          </Button>
        </>
      }
      overlay={opened === null ? null : <CardDialog dismiss={dismiss} member={opened} size={size} />}
    >
      {layout.pip ? pip : ARRANGEMENTS[layout.columns]}
    </Screen>
  );
};
