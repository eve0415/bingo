import type { Columns } from './layout';
import type { Visibility } from './model';
import type { NameLookup } from './names';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { WinLimitDto } from '@bingo/wasm/WinLimitDto';
import type { ClientMessage, RoomView } from '@bingo/wrapper/protocol';
import type { JSX } from 'react';

import { Button } from './button';
import { commandMessage, daubMessage, kickMessage, newGameMessage, settingsMessage, sizeMessage, winLimitMessage } from './commands';
import { DAUB_LABEL, PHASE_LABEL, VISIBILITY_LABEL, commitmentText, isSeated, rosterMembers, sameWinLimit, settingsSentence, winLimitLabel } from './model';
import { RosterRow } from './roster';
import { Note, Notice, Screen, Wordmark } from './screen';

const SIZES = [3, 5, 7, 9];
const DAUBS = ['Auto', 'Manual'] as const;
const VISIBILITIES = ['Full', 'LatestOnly', 'Hidden'] as const;
/** No limit first, because a party plays on until the gifts are gone. */
const WIN_LIMITS = [
  'Unlimited',
  'FirstOnly',
  {
    Count: 3,
  },
  {
    Count: 5,
  },
] as const satisfies readonly WinLimitDto[];

const Option = ({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element => (
  <Button onClick={onClick} pressed={on} variant={on ? 'primary' : 'secondary'}>
    {label}
  </Button>
);

/**
 * The lobby is the roster: who is here, what is about to be played, and the commitment that will make the deal verifiable afterwards.
 * Only the host sees the settings as controls, because only the host's changes the room will accept.
 */
export const Lobby = ({
  view,
  me,
  names,
  visibility,
  commitment,
  gameIndex,
  columns,
  dense,
  host,
  notice,
  onSend,
}: {
  view: RoomView;
  me: PlayerIdDto;
  names: NameLookup;
  visibility: Visibility;
  commitment: string | null;
  gameIndex: number;
  columns: Columns;
  dense: boolean;
  host: boolean;
  notice: string | null;
  onSend: (message: ClientMessage) => void;
}): JSX.Element => {
  const members = rosterMembers(view, me, names);
  // A finished game cannot be started again; the room needs a fresh one before it will take a Start.
  const over = view.phase === 'Finished';
  const seated = isSeated(view, me);
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
  return (
    <Screen
      dense={dense}
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
            ) : null}
          </div>
        </>
      }
      header={<Wordmark players={members.length} status={PHASE_LABEL.Lobby} />}
    >
      <div data-bingo-columns="" data-columns={columns}>
        <div data-bingo-column="">
          {members.length <= 1 ? <Note body="このアクティビティを開いた人から、順にここへ並びます。" title="まだあなただけです" /> : null}
          <section data-bingo-section="">
            <h2 data-bingo-label="">{host ? '次のゲームの設定' : '設定'}</h2>
            <p data-bingo-body="">{settingsSentence(view.config, visibility)}</p>
            {host ? (
              <>
                <p data-bingo-fine="">カードの設定を変えるとゲームを作り直します。退出させた人も入り直せるようになります。</p>
                <div data-bingo-options="">
                  {SIZES.map(size => (
                    <Option
                      key={size}
                      label={`${size}×${size}`}
                      on={view.config.size === size}
                      onClick={() => {
                        onSend(sizeMessage(view.config, size));
                      }}
                    />
                  ))}
                </div>
                <div data-bingo-options="">
                  {DAUBS.map(daub => (
                    <Option
                      key={daub}
                      label={DAUB_LABEL[daub]}
                      on={view.config.daub === daub}
                      onClick={() => {
                        onSend(daubMessage(view.config, daub));
                      }}
                    />
                  ))}
                </div>
                <div aria-label="終わり方" data-bingo-options="" role="group">
                  {WIN_LIMITS.map(limit => (
                    <Option
                      key={winLimitLabel(limit)}
                      label={winLimitLabel(limit)}
                      on={sameWinLimit(view.config.winLimit, limit)}
                      onClick={() => {
                        onSend(winLimitMessage(view.config, limit));
                      }}
                    />
                  ))}
                </div>
                <div data-bingo-options="">
                  {VISIBILITIES.map(option => (
                    <Option
                      key={option}
                      label={VISIBILITY_LABEL[option]}
                      on={visibility === option}
                      onClick={() => {
                        onSend(
                          settingsMessage({
                            drawnVisibility: option,
                          }),
                        );
                      }}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </section>
          <section data-bingo-section="">
            <h2 data-bingo-label="">コミットメント</h2>
            <p data-bingo-hash="">{commitmentText(commitment)}</p>
            <p data-bingo-fine="">
              {commitment === null
                ? 'ゲーム開始時に公開されます。終了後にシードと照合できます'
                : `ゲーム ${gameIndex} の開始時に公開。終了後にシードと照合できます`}
            </p>
          </section>
        </div>
        <div data-bingo-column="">
          <h2 data-bingo-label="">参加者 · {members.length}人</h2>
          <div data-bingo-roster="">
            {members.map(member => (
              <div data-bingo-roster-line="" key={member.entry.key}>
                <RosterRow entry={member.entry} />
                {host && !member.entry.isYou ? (
                  <Button
                    label={`${member.entry.name}を退出させる`}
                    onClick={() => {
                      onSend(kickMessage(member.player));
                    }}
                    variant="ghost"
                  >
                    退出させる
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
};
