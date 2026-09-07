import type { Visibility } from './model';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { DaubDto } from '@bingo/wasm/DaubDto';
import type { WinLimitDto } from '@bingo/wasm/WinLimitDto';
import type { ClientMessage } from '@bingo/wrapper/protocol';

import { daubMessage, settingsMessage, sizeMessage, winLimitMessage } from './commands';
import { DAUB_LABEL, VISIBILITY_LABEL, sameWinLimit, winLimitLabel } from './model';

/** The settings the lobby offers, in the order the room reads them: what the card is, how it is marked, when it ends, and how much of the draw is public. */
export type SettingKey = 'size' | 'daub' | 'winLimit' | 'visibility';

export interface SettingOption {
  readonly label: string;
  /** What choosing this does, said once under the control rather than as a legend beside every option. */
  readonly hint: string;
  readonly on: boolean;
  /** The board this option deals, drawn as an n×n field of dots; zero for options that are not board sizes. */
  readonly dots: number;
  readonly message: ClientMessage;
}

export interface SettingGroup {
  readonly key: SettingKey;
  readonly label: string;
  readonly sub: string;
  readonly options: readonly SettingOption[];
  /** The chosen option, which is the whole of what a player who cannot change it is shown. */
  readonly value: string;
  readonly hint: string;
}

const SIZES = [
  {
    size: 3,
    hint: '短時間向け。すぐに決まります',
  },
  {
    size: 5,
    hint: 'いつものビンゴ。B-I-N-G-O の5列',
  },
  {
    size: 7,
    hint: '長め。大人数の会に向いています',
  },
  {
    size: 9,
    hint: 'かなり長め。カードは横にスクロールします',
  },
] as const satisfies readonly { size: number; hint: string }[];
const DAUBS = ['Auto', 'Manual'] as const satisfies readonly DaubDto[];
const VISIBILITIES = ['Full', 'LatestOnly', 'Hidden'] as const satisfies readonly Visibility[];
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

const DAUB_HINT = {
  Auto: '呼ばれた番号はカードに自動で埋まります',
  Manual: '自分でマスをタップして埋めます。見落としも勝負のうち',
} as const satisfies Record<DaubDto, string>;

const VISIBILITY_HINT = {
  Full: '呼ばれた番号の一覧が全員に見えます',
  LatestOnly: 'いま呼ばれた番号だけが見えます',
  Hidden: '番号は画面に出ません。ホストが読み上げます',
} as const satisfies Record<Visibility, string>;

const winLimitHint = (limit: WinLimitDto): string => {
  if (limit === 'Unlimited') return '番号がなくなるまで続けます。景品がなくなるまで遊ぶ会に';
  return limit === 'FirstOnly' ? '最初のビンゴで終了します' : `${limit.Count}人がビンゴになったら終了します`;
};

/** A room can report a board this lobby does not offer, and a group with nothing selected still has to say something under it. */
const NOTHING = {
  label: '—',
  hint: '',
};

const group = (key: SettingKey, label: string, sub: string, options: readonly SettingOption[]): SettingGroup => {
  const selected: Pick<SettingOption, 'hint' | 'label'> = options.find(option => option.on) ?? NOTHING;
  return {
    key,
    label,
    sub,
    options,
    value: selected.label,
    hint: selected.hint,
  };
};

/**
 * Every control the lobby offers, as data: its copy, whether it is the one in force, and the single message choosing it sends.
 * The host taps them and a player reads the chosen one, so both screens are built from the same list rather than from two descriptions of it.
 */
export const settingGroups = (config: ConfigDto, visibility: Visibility): SettingGroup[] => [
  group(
    'size',
    'カード',
    'マスの数',
    SIZES.map(({ hint, size }) => ({
      label: `${size}×${size}`,
      hint,
      on: config.size === size,
      dots: size,
      message: sizeMessage(config, size),
    })),
  ),
  group(
    'daub',
    'マーク',
    '呼ばれた番号の埋め方',
    DAUBS.map(daub => ({
      label: DAUB_LABEL[daub],
      hint: DAUB_HINT[daub],
      on: config.daub === daub,
      dots: 0,
      message: daubMessage(config, daub),
    })),
  ),
  group(
    'winLimit',
    '終わり方',
    'ゲームが終了する条件',
    WIN_LIMITS.map(limit => ({
      label: winLimitLabel(limit),
      hint: winLimitHint(limit),
      on: sameWinLimit(config.winLimit, limit),
      dots: 0,
      message: winLimitMessage(config, limit),
    })),
  ),
  group(
    'visibility',
    '番号の表示',
    '参加者に見せる範囲',
    VISIBILITIES.map(option => ({
      label: VISIBILITY_LABEL[option],
      hint: VISIBILITY_HINT[option],
      on: visibility === option,
      dots: 0,
      message: settingsMessage({
        drawnVisibility: option,
      }),
    })),
  ),
];

/** What is about to be played, in one line, for a frame too short to show the controls themselves. */
export const settingsSummary = (groups: readonly SettingGroup[]): string => groups.map(entry => entry.value).join(' · ');
