import type { LobbyLayout } from './layout';
import type { RosterMember, Visibility } from './model';
import type { ProfileLookup } from './profiles';
import type { SettingGroup } from './settings';
import type { UiAction, UiState } from './uiState';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { arrowFocus, escapeToToggle } from './arrows';
import { Button } from './button';
import { commandMessage, kickMessage, newGameMessage, transferHostMessage } from './commands';
import { commitmentText, isSeated, overlayMember, rosterMembers } from './model';
import { RosterRow } from './roster';
import { Dialog, Notice, Screen, Wordmark } from './screen';
import { settingGroups, settingsSummary } from './settings';

/** The board an option deals, drawn rather than described: the 9×9 is visibly the long game before anyone has played it. */
const Dots = ({ size }: { size: number }): JSX.Element => (
  <span aria-hidden="true" data-bingo-dots="" data-size={size}>
    {Array.from({ length: size * size }, (_unused, index) => (
      <span key={index} />
    ))}
  </span>
);

/**
 * One row per setting: what it is, what it decides, and — under the control rather than beside every option — what the current choice means.
 * The hint is replaced in place inside a reserved line, so reading down the panel never moves the row under a thumb.
 */
const Setting = ({ group, host, onSend }: { group: SettingGroup; host: boolean; onSend: (message: ClientMessage) => void }): JSX.Element => (
  <div data-bingo-setting="">
    <div data-bingo-setting-name="">
      <span data-bingo-setting-title="">{group.label}</span>
      <span data-bingo-setting-sub="">{group.sub}</span>
    </div>
    <div data-bingo-setting-control="">
      {host ? (
        // Native radios, so the arrow keys, the single tab stop and the grouping are the platform's rather than a promise the markup would have to keep itself.
        <div aria-label={group.label} data-bingo-choices="" data-group={group.key} role="radiogroup">
          {group.options.map(option => (
            <label data-bingo-choice="" data-on={option.on} key={option.label}>
              <input
                checked={option.on}
                data-bingo-choice-input=""
                name={group.key}
                onChange={() => {
                  onSend(option.message);
                }}
                type="radio"
              />
              {option.dots === 0 ? null : <Dots size={option.dots} />}
              <span data-bingo-choice-label="">{option.label}</span>
            </label>
          ))}
        </div>
      ) : (
        <p data-bingo-setting-value="">{group.value}</p>
      )}
      <p data-bingo-setting-hint="" key={group.value}>
        {group.hint}
      </p>
    </div>
  </div>
);

/**
 * Removing someone and handing the room over are the two things a host can do to another person, so they live behind the row rather than in front of it.
 * The menu is anchored to the row instead of taking the screen, and the layer that closes it is a control with a name rather than a document listener.
 */
const RowMenu = ({
  member,
  onSend,
  onUi,
  open,
}: {
  member: RosterMember;
  onSend: (message: ClientMessage) => void;
  onUi: (action: UiAction) => void;
  open: boolean;
}): JSX.Element => {
  const dismiss = (): void => {
    onUi({
      type: 'dismiss',
    });
  };
  return (
    <div data-bingo-menu-anchor="">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${member.entry.name}の操作`}
        data-bingo-menu-toggle=""
        data-on={open}
        onClick={
          open
            ? dismiss
            : (): void => {
                onUi({
                  type: 'open',
                  overlay: {
                    kind: 'menu',
                    player: member.entry.key,
                  },
                });
              }
        }
        type="button"
      >
        ···
      </button>
      {open ? (
        <>
          <button aria-label="メニューを閉じる" data-bingo-menu-dismiss="" onClick={dismiss} type="button" />
          {/* Opening it moves focus into it, the arrow keys move along it, and it is one tab stop rather than two — which is what the role promises. */}
          <div
            aria-label={`${member.entry.name}の操作`}
            data-bingo-menu=""
            onKeyDown={event => {
              escapeToToggle(event, dismiss);
            }}
            role="menu"
          >
            <button
              autoFocus
              data-bingo-menu-item=""
              onKeyDown={arrowFocus}
              tabIndex={0}
              onClick={() => {
                onUi({
                  type: 'open',
                  overlay: {
                    kind: 'promote',
                    player: member.entry.key,
                  },
                });
              }}
              role="menuitem"
              type="button"
            >
              <span aria-hidden="true" data-bingo-menu-glyph="">
                ▲
              </span>
              ホストにする
            </button>
            <button
              data-bingo-menu-item=""
              data-danger="true"
              onKeyDown={arrowFocus}
              tabIndex={-1}
              onClick={() => {
                dismiss();
                onSend(kickMessage(member.player));
              }}
              role="menuitem"
              type="button"
            >
              <span aria-hidden="true" data-bingo-menu-glyph="">
                ×
              </span>
              退出させる
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
};

/**
 * The lobby is the roster: who is here, what is about to be played, and the commitment that will make the deal verifiable afterwards.
 * Only the host sees the settings as controls, because only the host's changes the room will accept.
 */
export const Lobby = ({
  view,
  me,
  profiles,
  visibility,
  commitment,
  gameIndex,
  layout,
  host,
  notice,
  ui,
  onUi,
  onSend,
}: {
  view: RoomView;
  me: PlayerIdDto;
  profiles: ProfileLookup;
  visibility: Visibility;
  commitment: string | null;
  gameIndex: number;
  layout: LobbyLayout;
  host: boolean;
  notice: string | null;
  ui: UiState;
  onUi: (action: UiAction) => void;
  onSend: (message: ClientMessage) => void;
}): JSX.Element => {
  const members = rosterMembers(view, me, profiles);
  const groups = settingGroups(view.config, visibility);
  // A finished game cannot be started again; the room needs a fresh one before it will take a Start.
  const over = view.phase === 'Finished';
  const seated = isSeated(view, me);
  const alone = members.length <= 1;
  const menued = host && !over && members.some(member => !member.entry.isYou);
  // A finished game refuses a kick and a host transfer for the reason it refuses a seat, so the row that offers both is not drawn there either.
  const promoting = overlayMember(ui.overlay, members, ['promote']);
  const menuing = overlayMember(ui.overlay, members, ['menu']);
  const dismiss = (): void => {
    onUi({
      type: 'dismiss',
    });
  };
  // The engine refuses both Join and Leave once a game is finished, so a control offering either would only ever report a refusal.
  const seat = over ? null : (
    <Button
      onClick={() => {
        onSend(commandMessage(seated ? 'Leave' : 'Join'));
      }}
      size="lg"
      variant="ghost"
    >
      {seated ? '参加しない' : '参加する'}
    </Button>
  );
  const roster = (
    <div data-bingo-column="">
      <div data-bingo-head="">
        <h2 data-bingo-label="">参加者</h2>
        <span data-bingo-count="">{members.length}人</span>
      </div>
      <div data-bingo-roster="">
        {members.map(member => (
          <div data-bingo-roster-line="" key={member.entry.key}>
            <RosterRow entry={member.entry} roster="lobby" />
            {menued && !member.entry.isYou ? <RowMenu member={member} onSend={onSend} onUi={onUi} open={menuing?.entry.key === member.entry.key} /> : null}
          </div>
        ))}
        {alone ? (
          // The outline sits in the same line as a real row, spacer and all, so its right edge lands where theirs does.
          <div data-bingo-roster-line="">
            <div data-bingo-roster-empty="">
              <span aria-hidden="true" data-bingo-empty-avatar="" />
              <p data-bingo-empty-body="">このアクティビティを開いた人から、ここに並びます</p>
            </div>
            {menued ? <span aria-hidden="true" data-bingo-menu-spacer="" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
  const settings = (
    <div data-bingo-column="">
      <div data-bingo-head="">
        <h2 data-bingo-label="">{host ? '次のゲームの設定' : '設定'}</h2>
        {host && !alone ? <span data-bingo-fine="">カードの設定を変えるとゲームを作り直します</span> : null}
      </div>
      <div data-bingo-settings="" data-rows={layout.rows}>
        {groups.map(group => (
          <Setting group={group} host={host} key={group.key} onSend={onSend} />
        ))}
      </div>
      <div data-bingo-commit="">
        <p data-bingo-fine="">
          コミットメント<span aria-hidden="true"> · </span>
          <span data-bingo-hash="">{commitmentText(commitment)}</span>
        </p>
        <p data-bingo-fine="">
          {commitment === null
            ? 'ゲーム開始時に公開されます。終了後にシードと照合できます'
            : `ゲーム ${gameIndex} の開始時に公開。終了後にシードと照合できます`}
        </p>
      </div>
    </div>
  );
  return (
    <Screen
      edge={layout.edge}
      footer={
        <>
          <Notice notice={notice} />
          <div data-bingo-actions="">
            {seat}
            {host ? (
              <Button
                block
                disabled={members.length === 0}
                onClick={() => {
                  onSend(over ? newGameMessage(null) : commandMessage('Start'));
                }}
                size="lg"
                variant="primary"
              >
                {over ? '新しいゲームを作る' : 'ゲームを開始'}
              </Button>
            ) : (
              <p data-bingo-waiting="">
                <span aria-hidden="true" data-bingo-waiting-dot="" />
                ホストの開始を待っています
              </p>
            )}
          </div>
        </>
      }
      header={<Wordmark players={members.length} />}
      overlay={
        promoting === null ? null : (
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
                    onSend(transferHostMessage(promoting.player));
                  }}
                  variant="paper"
                >
                  ホストにする
                </Button>
              </>
            }
            onDismiss={dismiss}
            title={`${promoting.entry.name}をホストにしますか`}
          >
            <p data-bingo-body="">あなたはホストではなくなり、参加者として続けます。設定と進行はその人に移ります。</p>
          </Dialog>
        )
      }
    >
      {layout.pip ? (
        <div data-bingo-pip="">
          <p data-bingo-pip-title="">{alone ? 'まだあなただけです' : `${members.length}人が待っています`}</p>
          <p data-bingo-pip-summary="">{settingsSummary(groups)}</p>
        </div>
      ) : (
        // A lobby read by someone who is not the host has no control in it, so without this the region it scrolls is one a keyboard cannot reach.
        <div data-bingo-lobby="" data-columns={layout.columns} tabIndex={0}>
          {roster}
          {settings}
        </div>
      )}
    </Screen>
  );
};
