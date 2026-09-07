import { describe, expect, it } from 'vitest';

import { daubMessage, settingsMessage, sizeMessage, winLimitMessage } from '../../app/room/commands';
import { settingGroups, settingsSummary } from '../../app/room/settings';

import { config } from './fixture';

describe('the lobby settings', () => {
  it('offers every choice the room takes, each carrying the one message that makes it', (): void => {
    const groups = settingGroups(config(), 'Full');
    expect(groups.map(group => group.key)).toEqual(['size', 'daub', 'winLimit', 'visibility']);
    expect(groups.map(group => group.label)).toEqual(['カード', 'マーク', '終わり方', '番号の表示']);
    expect(groups.map(group => group.sub)).toEqual(['マスの数', '呼ばれた番号の埋め方', 'ゲームが終了する条件', '参加者に見せる範囲']);
    expect(groups.flatMap(group => group.options.map(option => option.message))).toEqual([
      sizeMessage(config(), 3),
      sizeMessage(config(), 5),
      sizeMessage(config(), 7),
      sizeMessage(config(), 9),
      daubMessage(config(), 'Auto'),
      daubMessage(config(), 'Manual'),
      winLimitMessage(config(), 'Unlimited'),
      winLimitMessage(config(), 'FirstOnly'),
      winLimitMessage(config(), { Count: 3 }),
      winLimitMessage(config(), { Count: 5 }),
      settingsMessage({ drawnVisibility: 'Full' }),
      settingsMessage({ drawnVisibility: 'LatestOnly' }),
      settingsMessage({ drawnVisibility: 'Hidden' }),
    ]);
  });

  it('marks the choice in force and says under it what that choice does', (): void => {
    const groups = settingGroups(config(), 'LatestOnly');
    expect(groups.map(group => group.value)).toEqual(['5×5', '自分でタップ', '最後まで', '最新だけ']);
    expect(groups.map(group => group.hint)).toEqual([
      'いつものビンゴ。B-I-N-G-O の5列',
      '自分でマスをタップして埋めます。見落としも勝負のうち',
      '番号がなくなるまで続けます。景品がなくなるまで遊ぶ会に',
      'いま呼ばれた番号だけが見えます',
    ]);
    expect(groups[0].options.map(option => option.on)).toEqual([false, true, false, false]);
    // Only a board size draws itself; the rest of the options are words.
    expect(groups[0].options.map(option => option.dots)).toEqual([3, 5, 7, 9]);
    expect(groups[1].options.every(option => option.dots === 0)).toBe(true);
  });

  it('reads a counted limit by value, and each count explains its own ending', (): void => {
    const groups = settingGroups({ ...config(), size: 7, daub: 'Auto', winLimit: { Count: 5 } }, 'Hidden');
    expect(groups.map(group => group.value)).toEqual(['7×7', '自動', '5人', '隠す']);
    expect(groups[2].hint).toBe('5人がビンゴになったら終了します');
    expect(groups[2].options.map(option => option.hint)).toEqual([
      '番号がなくなるまで続けます。景品がなくなるまで遊ぶ会に',
      '最初のビンゴで終了します',
      '3人がビンゴになったら終了します',
      '5人がビンゴになったら終了します',
    ]);
    expect(groups[1].hint).toBe('呼ばれた番号はカードに自動で埋まります');
    expect(groups[3].hint).toBe('番号は画面に出ません。ホストが読み上げます');
    expect(groups[0].hint).toBe('長め。大人数の会に向いています');
  });

  it('says nothing rather than guessing when the room is playing a board this lobby does not offer', (): void => {
    const groups = settingGroups({ ...config(), size: 4 }, 'Full');
    expect(groups[0].value).toBe('—');
    expect(groups[0].hint).toBe('');
    expect(groups[0].options.some(option => option.on)).toBe(false);
  });

  it('reads the whole panel as one line for a frame with no room for the panel', (): void => {
    const chosen = settingGroups(config(), 'Full');
    const other = settingGroups({ ...config(), size: 3, daub: 'Auto', winLimit: 'FirstOnly' }, 'Hidden');
    expect(settingsSummary(chosen)).toBe('5×5 · 自分でタップ · 最後まで · すべて');
    expect(settingsSummary(other)).toBe('3×3 · 自動 · 1人 · 隠す');
  });

  it('draws the smallest board the room offers and the largest one it does', (): void => {
    const groups = settingGroups({ ...config(), size: 9 }, 'Full');
    expect(groups[0].value).toBe('9×9');
    expect(groups[0].hint).toBe('かなり長め。カードは横にスクロールします');
    const small = settingGroups({ ...config(), size: 3 }, 'Full');
    expect(small[0].hint).toBe('短時間向け。すぐに決まります');
  });
});
