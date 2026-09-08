import type { CalledEntry } from './call';
import type { PendingMark } from './connection';
import type { Columns, HostLayout } from './layout';
import type { RosterMember, Visibility } from './model';
import type { ProfileLookup } from './profiles';
import type { PanelTab } from './screen';
import type { HostOverlayKind, Panel, UiAction, UiState } from './uiState';
import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Button } from './button';
import { CalledNumber } from './call';
import { BingoCard } from './card';
import { StatusChip } from './chip';
import { cellMessage, commandMessage, kickMessage, seatMessage } from './commands';
import { Flashboard } from './flashboard';
import { screenEdge } from './layout';
import { cardCells, isReach, poolSize, strikeLines } from './lines';
import { calledEntries, cardsOf, isSeated, overlayMember, pendingFor, progressLabel, rosterMembers, seatLabel } from './model';
import { RosterRow } from './roster';
import { Dialog, Notice, ReachNote, Screen, Tabs, Wordmark } from './screen';
import { hostOverlay } from './uiState';

/**
 * Side by side the undo sits to the left of the draw, the way a pair of controls reads; stacked it goes under it,
 * because the primary action takes the top of a column. The order on screen is the order in the markup either way.
 */
const Draw = ({
  blocked,
  nothingToUndo,
  onSend,
  stacked = false,
}: {
  blocked: boolean;
  nothingToUndo: boolean;
  onSend: (message: ClientMessage) => void;
  stacked?: boolean;
}): JSX.Element => {
  const size = stacked ? 'md' : 'lg';
  const undo = (
    <Button
      block={stacked}
      disabled={blocked || nothingToUndo}
      key="undo"
      onClick={() => {
        onSend(commandMessage('Undo'));
      }}
      size={size}
      variant="ghost"
    >
      取り消す
    </Button>
  );
  const draw = (
    <Button
      block
      disabled={blocked}
      key="draw"
      onClick={() => {
        onSend(commandMessage('Draw'));
      }}
      size={size}
      variant="primary"
    >
      番号を引く
    </Button>
  );
  return (
    <div data-bingo-actions="" data-stack={stacked}>
      {stacked ? [draw, undo] : [undo, draw]}
    </div>
  );
};

/**
 * The hero box has a strip under it for what came before; the compact one has no room for a strip, so its tail sits inside the box.
 * A narrow frame keeps two of them rather than three.
 */
const HostCall = ({
  dense,
  history,
  latest,
  layout,
  progress,
}: {
  dense: boolean;
  history: readonly CalledEntry[];
  latest: CalledEntry | null;
  layout: HostLayout;
  progress: string;
}): JSX.Element => {
  const hero = layout.callVariant === 'hero';
  return (
    <CalledNumber
      history={hero ? history : undefined}
      idle="最初の番号を引くと、ここに履歴が並びます"
      latest={latest}
      progress={progress}
      recent={hero ? undefined : history.slice(0, dense ? 2 : 3)}
      variant={layout.callVariant}
    />
  );
};

/** The host reads three panels, and the roster segment carries its own count because the number is worth having without opening it. */
const hostPanels = (players: number): readonly PanelTab[] => [
  {
    panel: 'board',
    label: '盤面',
  },
  {
    panel: 'roster',
    label: '参加者',
    count: players,
  },
  {
    panel: 'card',
    label: 'カード',
  },
];

/** What the host's screen actually has to draw. Ending the game is about the game; a card and a removal are about a person. */
type HostDialog = { readonly kind: 'close' } | { readonly kind: 'card' | 'kick'; readonly member: RosterMember };

/**
 * The screen goes inert behind whatever overlay it is handed, whether or not that overlay drew anything,
 * so an overlay with nobody left to be about has to be dropped here rather than rendered as nothing.
 * A player can leave while the host is reading their card, which takes them out of the roster this is resolved against.
 */
const hostDialog = (overlay: HostOverlayKind | null, member: RosterMember | null): HostDialog | null => {
  if (overlay === null) return null;
  if (overlay.kind === 'close') {
    return {
      kind: 'close',
    };
  }
  // Your own card is not something the roster offers to open either, so an overlay naming you is stale for the same reason.
  if (member === null || member.entry.isYou) return null;
  return {
    kind: overlay.kind,
    member,
  };
};

const HostOverlay = ({
  dialog,
  dismiss,
  onSend,
  onUi,
  pending,
  view,
}: {
  dialog: HostDialog;
  dismiss: () => void;
  onSend: (message: ClientMessage) => void;
  onUi: (action: UiAction) => void;
  pending: readonly PendingMark[];
  view: RoomView;
}): JSX.Element => {
  if (dialog.kind === 'close') {
    return (
      <Dialog
        actions={
          <>
            <Button block onClick={dismiss} variant="secondary">
              やめる
            </Button>
            <Button
              block
              onClick={() => {
                dismiss();
                onSend(commandMessage('Close'));
              }}
              variant="danger"
            >
              終了する
            </Button>
          </>
        }
        onDismiss={dismiss}
        title="ゲームを終了しますか"
      >
        <p data-bingo-body="">いまの番号とカードは記録に残ります。全員が待機中に戻ります。</p>
      </Dialog>
    );
  }
  const { member } = dialog;
  if (dialog.kind === 'kick') {
    return (
      <Dialog
        actions={
          <>
            <Button block onClick={dismiss} variant="secondary">
              やめる
            </Button>
            <Button
              block
              onClick={() => {
                dismiss();
                onSend(kickMessage(member.player));
              }}
              variant="danger"
            >
              退出させる
            </Button>
          </>
        }
        onDismiss={dismiss}
        title={`${member.entry.name}を退出させますか`}
      >
        <p data-bingo-body="">この部屋から外れます。もう一度招待すれば戻れます。</p>
      </Dialog>
    );
  }
  return (
    <Dialog
      actions={
        <>
          <Button
            onClick={() => {
              onUi({
                type: 'open',
                overlay: {
                  kind: 'kick',
                  player: member.entry.key,
                },
              });
            }}
            variant="danger"
          >
            退出させる
          </Button>
          <Button onClick={dismiss} variant="paper">
            閉じる
          </Button>
        </>
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
      {/* The dialogue covers the call, so there is no reel on screen for a mark to get ahead of. */}
      {member.cards.map(card => (
        <BingoCard
          cells={cardCells(card, pendingFor(pending, card.cardIx, view.config.size), null)}
          flat
          key={card.cardIx}
          lines={strikeLines(card.bingo, view.config.size)}
          maxWidth="100%"
          size={view.config.size}
        />
      ))}
    </Dialog>
  );
};

/**
 * Drawing is the host's one primary action, and everything else on the screen answers a question the caller is actually asked:
 * what has gone, who is close, and may I see that card.
 */
export const Host = ({
  view,
  me,
  profiles,
  visibility,
  drawnOrder,
  pending,
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
  pending: readonly PendingMark[];
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
  const mine = cardsOf(view, me);
  const seated = isSeated(view, me);
  const manual = view.config.daub === 'Manual' && view.phase === 'Running';
  // A card marked by hand answers the tap rather than the draw, so only an automatic mark waits for the reel.
  const rolling = latest === null || view.config.daub === 'Manual' ? null : latest.value;
  const tapFor =
    (card: CardViewDto) =>
    (index: number): void => {
      onSend(cellMessage(card.cardIx, index, size, card.marked.includes(index)));
    };
  const exhausted = visibility === 'Full' && drawnOrder.length >= poolSize(size);
  // Under restricted visibility the order is truncated, so an empty one is only evidence of an empty draw when the room is publishing all of it.
  const blocked = view.phase !== 'Running' || exhausted;
  const nothingToUndo = visibility === 'Full' && drawnOrder.length === 0;
  const draw = <Draw blocked={blocked} nothingToUndo={nothingToUndo} onSend={onSend} />;
  const dismiss = (): void => {
    onUi({
      type: 'dismiss',
    });
  };
  const switcher = layout.columns === 'one' || layout.columns === 'beside';
  const dialog = hostDialog(hostOverlay(ui.overlay), overlayMember(ui.overlay, members, ['card', 'kick']));
  const reaching = members.filter(member => member.entry.status === 'reach').length;
  const bingoing = members.filter(member => member.entry.status === 'bingo').length;
  const call = (
    <>
      <HostCall dense={dense} history={history} latest={latest} layout={layout} progress={progressLabel(drawnOrder.length, size, visibility)} />
      <p data-bingo-label="">
        参加者 {members.length}人 · リーチ {reaching} · ビンゴ {bingoing}
      </p>
      <Notice notice={notice} />
    </>
  );
  const board = (
    <>
      <div data-bingo-head="">
        <h2 data-bingo-label="">呼ばれた番号</h2>
        <span data-bingo-count="">{progressLabel(drawnOrder.length, size, visibility)}</span>
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
        {/* The same glyphs the chips carry, so the tally reads without colour. */}
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
              // Your own card is a tab away and, on a desk, already beside the roster; a dialogue over the call would show you what you are looking at.
              member.cards.length === 0 || member.entry.isYou
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
  const own = (
    <div data-bingo-own="" style={{ maxWidth: `${layout.cardMax}px` }}>
      {/* The reach line sits on the heading's own row, which is already reserved, rather than taking a second one under it. */}
      <div data-bingo-head="">
        <h2 data-bingo-label="">あなたのカード</h2>
        <ReachNote reach={mine.some(card => isReach(card))} />
      </div>
      {mine.length === 0 ? (
        <p data-bingo-sitting-out="">今回はカードを持たずに進行しています</p>
      ) : (
        mine.map(card => (
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
      {/* Calling the game and playing it are separate, so the room stays with whoever is running it either way. */}
      <div data-bingo-actions="">
        <Button
          block
          onClick={() => {
            onSend(seatMessage(seated));
          }}
          variant="ghost"
        >
          {seatLabel(seated)}
        </Button>
      </div>
    </div>
  );
  // Discord has shrunk the activity to a corner of the call. The number, who is close, and the draw are what still fit; the header keeps the way out.
  const pip = (
    <div data-bingo-pip-host="">
      <div data-bingo-pip-call="">
        <CalledNumber latest={latest} progress={progressLabel(drawnOrder.length, size, visibility)} variant="compact" />
        <p data-bingo-label="">
          参加者 {members.length}人 · リーチ {reaching} · ビンゴ {bingoing}
        </p>
        <Notice notice={notice} />
      </div>
      <Draw blocked={blocked} nothingToUndo={nothingToUndo} onSend={onSend} stacked />
    </div>
  );
  const PANEL_CONTENT = {
    board,
    roster,
    card: own,
  } satisfies Record<Panel, JSX.Element>;
  const switched = (
    <div data-bingo-columns="" data-columns={layout.columns}>
      <div data-bingo-column="">
        {call}
        {layout.columns === 'beside' ? draw : null}
      </div>
      <div data-bingo-switch="">
        <Tabs
          current={ui.panel}
          panels={hostPanels(members.length)}
          onPanel={(panel): void => {
            onUi({
              type: 'panel',
              panel,
            });
          }}
        />
        {/* The flashboard panel is all divs, so the region it scrolls needs to be reachable in its own right. */}
        <div data-bingo-panel="" tabIndex={0}>
          {PANEL_CONTENT[ui.panel]}
        </div>
      </div>
    </div>
  );
  /* Two columns have no room for a third, so the card goes under the board it is being played against rather than into a column that wraps below the fold. */
  const split = (
    <div data-bingo-columns="" data-columns={layout.columns}>
      <div data-bingo-column="">
        {call}
        {draw}
        {board}
        {own}
      </div>
      <div data-bingo-column="">{roster}</div>
    </div>
  );
  const desk = (
    <div data-bingo-columns="" data-columns={layout.columns}>
      <div data-bingo-column="">
        {call}
        {draw}
        {board}
      </div>
      <div data-bingo-column="">{roster}</div>
      <div data-bingo-column="">{own}</div>
    </div>
  );
  const ARRANGEMENTS = {
    one: switched,
    beside: switched,
    split,
    desk,
  } satisfies Record<Columns, JSX.Element>;
  const arranged = ARRANGEMENTS[layout.columns];
  return (
    <Screen
      edge={screenEdge(dense)}
      footer={layout.pip || layout.columns !== 'one' ? null : draw}
      header={
        <>
          {/* The count and the total are on screen twice already, in the call box and over the board. */}
          <Wordmark players={members.length} />
          {switcher || layout.pip ? null : <StatusChip size="sm" status="host" />}
          <Button
            onClick={() => {
              onUi({
                type: 'open',
                overlay: {
                  kind: 'close',
                },
              });
            }}
            variant="ghost"
          >
            ゲームを終了
          </Button>
        </>
      }
      overlay={dialog === null ? null : <HostOverlay dialog={dialog} dismiss={dismiss} onSend={onSend} onUi={onUi} pending={pending} view={view} />}
    >
      {layout.pip ? pip : arranged}
    </Screen>
  );
};
