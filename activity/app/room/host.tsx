import type { PendingMark } from './connection';
import type { HostLayout } from './layout';
import type { RosterMember, Visibility } from './model';
import type { NameLookup } from './names';
import type { Overlay, Panel, UiAction, UiState } from './uiState';
import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Button } from './button';
import { CalledNumber } from './call';
import { BingoCard } from './card';
import { StatusChip } from './chip';
import { cellMessage, commandMessage, kickMessage } from './commands';
import { cardCells, isReach, poolSize, strikeLines } from './lines';
import { calledEntries, cardsOf, flashboard, pendingFor, progressLabel, rosterMembers } from './model';
import { RosterRow } from './roster';
import { Dialog, Notice, ReachNote, Screen, Wordmark } from './screen';

const Flashboard = ({ drawnOrder, size }: { drawnOrder: readonly number[]; size: number }): JSX.Element => (
  <div data-bingo-flash="" data-lettered={size === 5}>
    {flashboard(drawnOrder, size).map(row => (
      <div data-bingo-flash-row="" key={row.letter ?? row.cells[0].value}>
        <div aria-hidden="true" data-bingo-flash-letter="">
          {row.letter}
        </div>
        {row.cells.map(cell => (
          <div
            aria-label={`${cell.value} ${cell.called ? '呼ばれた' : 'まだ'}`}
            data-bingo-flash-cell=""
            data-called={cell.called}
            data-live={cell.live}
            key={cell.value}
            role="img"
          >
            {cell.value}
          </div>
        ))}
      </div>
    ))}
  </div>
);

const Draw = ({ blocked, nothingToUndo, onSend }: { blocked: boolean; nothingToUndo: boolean; onSend: (message: ClientMessage) => void }): JSX.Element => (
  <div data-bingo-actions="">
    <Button
      disabled={blocked || nothingToUndo}
      onClick={() => {
        onSend(commandMessage('Undo'));
      }}
      size="lg"
      variant="ghost"
    >
      取り消す
    </Button>
    <Button
      block
      disabled={blocked}
      onClick={() => {
        onSend(commandMessage('Draw'));
      }}
      size="lg"
      variant="primary"
    >
      番号を引く
    </Button>
  </div>
);

const PANELS = [
  {
    panel: 'board',
    label: '盤面',
  },
  {
    panel: 'roster',
    label: '参加者',
  },
  {
    panel: 'card',
    label: 'カード',
  },
] as const satisfies readonly { panel: Panel; label: string }[];

const Tabs = ({ current, onPanel }: { current: Panel; onPanel: (panel: Panel) => void }): JSX.Element => (
  <div data-bingo-tabs="">
    {PANELS.map(entry => (
      <Button
        key={entry.panel}
        onClick={() => {
          onPanel(entry.panel);
        }}
        pressed={current === entry.panel}
        variant={current === entry.panel ? 'primary' : 'secondary'}
      >
        {entry.label}
      </Button>
    ))}
  </div>
);

const overlayFor = (ui: UiState, members: readonly RosterMember[]): RosterMember | null =>
  members.find(member => (ui.overlay?.kind === 'card' || ui.overlay?.kind === 'kick' ? member.entry.key === ui.overlay.player : false)) ?? null;

const HostOverlay = ({
  dismiss,
  member,
  onSend,
  onUi,
  overlay,
  pending,
  view,
}: {
  dismiss: () => void;
  member: RosterMember | null;
  onSend: (message: ClientMessage) => void;
  onUi: (action: UiAction) => void;
  overlay: NonNullable<Overlay>;
  pending: readonly PendingMark[];
  view: RoomView;
}): JSX.Element | null => {
  if (overlay.kind === 'close') {
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
  if (member === null) return null;
  if (overlay.kind === 'kick') {
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
          {member.entry.isYou ? null : (
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
          )}
          <Button onClick={dismiss} variant="paper">
            閉じる
          </Button>
        </>
      }
      aside={<StatusChip status={member.entry.status} surface="paper" />}
      onDismiss={dismiss}
      title={`${member.entry.name}のカード`}
    >
      <p data-bingo-body="">マーク {member.entry.marks}</p>
      {member.cards.map(card => (
        <BingoCard
          cells={cardCells(card, pendingFor(pending, card.cardIx, view.config.size))}
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
  names,
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
  names: NameLookup;
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
  const { latest } = calledEntries(drawnOrder, size);
  const members = rosterMembers(view, me, names);
  const mine = cardsOf(view, me);
  const manual = view.config.daub === 'Manual' && view.phase === 'Running';
  const tapFor =
    (card: CardViewDto) =>
    (index: number): void => {
      onSend(cellMessage(card.cardIx, index, size, card.marked.includes(index)));
    };
  const exhausted = visibility === 'Full' && drawnOrder.length >= poolSize(size);
  // Under restricted visibility the order is truncated, so an empty one is only evidence of an empty draw when the room is publishing all of it.
  const draw = <Draw blocked={view.phase !== 'Running' || exhausted} nothingToUndo={visibility === 'Full' && drawnOrder.length === 0} onSend={onSend} />;
  const dismiss = (): void => {
    onUi({
      type: 'dismiss',
    });
  };
  const switcher = layout.columns === 'one' || layout.columns === 'beside';
  const shown = overlayFor(ui, members);
  const reaching = members.filter(member => member.entry.status === 'reach').length;
  const bingoing = members.filter(member => member.entry.status === 'bingo').length;
  const call = (
    <>
      <CalledNumber latest={latest} progress={progressLabel(drawnOrder.length, size, visibility)} variant={layout.callVariant} />
      <p data-bingo-label="">
        参加者 {members.length}人 · リーチ {reaching} · ビンゴ {bingoing}
      </p>
      <Notice notice={notice} />
    </>
  );
  const board = (
    <>
      <h2 data-bingo-label="">呼ばれた番号 · {progressLabel(drawnOrder.length, size, visibility)}</h2>
      <Flashboard drawnOrder={drawnOrder} size={size} />
    </>
  );
  const roster = (
    <>
      <h2 data-bingo-label="">
        参加者 · {members.length}人 · リーチ {reaching} · ビンゴ {bingoing}
      </h2>
      <div data-bingo-roster="">
        {members.map(member => (
          <RosterRow
            entry={member.entry}
            key={member.entry.key}
            onOpen={
              member.cards.length === 0
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
    <>
      <h2 data-bingo-label="">あなたのカード</h2>
      <ReachNote reach={mine.some(card => isReach(card))} />
      {mine.length === 0 ? (
        <p data-bingo-sitting-out="">今回はカードを持たずに進行しています</p>
      ) : (
        mine.map(card => (
          <BingoCard
            cells={cardCells(card, pendingFor(pending, card.cardIx, size))}
            key={card.cardIx}
            lines={strikeLines(card.bingo, size)}
            maxWidth={`${layout.cardMax}px`}
            onTap={manual ? tapFor(card) : undefined}
            size={size}
          />
        ))
      )}
    </>
  );
  const PANEL_CONTENT = {
    board,
    roster,
    card: own,
  } satisfies Record<Panel, JSX.Element>;
  return (
    <Screen
      dense={dense}
      footer={layout.columns === 'one' ? draw : null}
      header={
        <>
          <Wordmark players={members.length} status={progressLabel(drawnOrder.length, size, visibility)} />
          {switcher ? null : <StatusChip size="sm" status="host" />}
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
      overlay={
        ui.overlay === null ? null : (
          <HostOverlay dismiss={dismiss} member={shown} onSend={onSend} onUi={onUi} overlay={ui.overlay} pending={pending} view={view} />
        )
      }
    >
      {switcher ? (
        <div data-bingo-columns="" data-columns={layout.columns}>
          <div data-bingo-column="">
            {call}
            {layout.columns === 'beside' ? draw : null}
          </div>
          <div data-bingo-switch="">
            <Tabs
              current={ui.panel}
              onPanel={(panel): void => {
                onUi({
                  type: 'panel',
                  panel,
                });
              }}
            />
            <div data-bingo-panel="">{PANEL_CONTENT[ui.panel]}</div>
          </div>
        </div>
      ) : (
        <div data-bingo-columns="" data-columns={layout.columns}>
          <div data-bingo-column="">
            {call}
            {draw}
            {board}
          </div>
          <div data-bingo-column="">{roster}</div>
          <div data-bingo-column="" data-bingo-host-card="">
            {own}
          </div>
        </div>
      )}
    </Screen>
  );
};
