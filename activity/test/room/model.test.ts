import type { RoomState } from '../../app/room/connection';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { RoomView } from '@bingo/wrapper/protocol';

import { describe, expect, it } from 'vitest';

import {
  DAUB_LABEL,
  PHASE_LABEL,
  VISIBILITY_LABEL,
  calledEntries,
  cardsOf,
  commitmentText,
  flashboard,
  isHost,
  isSeated,
  noticeOf,
  pendingFor,
  progressLabel,
  rosterMembers,
  sameWinLimit,
  visibilityOf,
  winLimitLabel,
  winnerCards,
  winnerGroups,
} from '../../app/room/model';

import { HOST, ME, OTHER, PROFILES, card, committedRoom, room, state, view } from './fixture';

const WATCHER: PlayerIdDto = {
  issuer: 'discord',
  subject: 'watcher-0004',
};

const refused = (code: string): RoomState => ({
  ...state(),
  failure: {
    origin: 'room',
    code,
    detail: null,
  },
});

const closed = (reason: string): RoomState => ({
  ...state(),
  status: 'closed',
  closure: {
    code: 1008,
    reason,
  },
});

const running = (): RoomView => ({
  ...view(),
  players: [HOST, ME, OTHER, WATCHER],
  cards: [
    {
      ...card(ME),
      bingo: [[0, 1, 2, 3, 4]],
    },
    {
      ...card(OTHER),
      cardIx: 1,
      marked: [12, 0],
      reach: [[1, 2, 3, 4]],
    },
  ],
});

describe('the called number', () => {
  it('has nothing to show before the first draw', (): void => {
    expect(calledEntries([], 5)).toEqual({
      latest: null,
      history: [],
    });
  });

  it('names the latest draw and reverses the rest', (): void => {
    expect(calledEntries([1, 20, 50], 5)).toEqual({
      latest: {
        value: 50,
        letter: 'G',
      },
      history: [
        { value: 20, letter: 'I' },
        { value: 1, letter: 'B' },
      ],
    });
  });
});

describe('draw progress', () => {
  it('counts the draw only while the room shows all of it', (): void => {
    expect(progressLabel(3, 5, 'Full')).toBe('3 / 75');
    expect(progressLabel(3, 5, 'LatestOnly')).toBe('—');
    expect(progressLabel(3, 5, 'Hidden')).toBe('—');
  });

  it('reads the visibility the room settled on, defaulting to showing everything', (): void => {
    expect(visibilityOf(state())).toBe('Full');
    expect(
      visibilityOf({
        ...state(),
        room: null,
      }),
    ).toBe('Full');
    expect(
      visibilityOf({
        ...state(),
        room: {
          ...room(),
          settings: {
            ...room().settings,
            drawnVisibility: 'Hidden',
          },
        },
      }),
    ).toBe('Hidden');
  });
});

describe('the roster', () => {
  it('names, colours and grades every player of a running game', (): void => {
    const members = rosterMembers(running(), ME, PROFILES);
    expect(members.map(member => member.entry.status)).toEqual(['host', 'bingo', 'reach', 'playing']);
    expect(members.map(member => member.entry.name)).toEqual(['ホストさん', '🎲ぼく', 'プレイヤー 0003', 'プレイヤー 0004']);
    expect(members.map(member => member.entry.marks)).toEqual([null, { marked: 1, total: 25 }, { marked: 2, total: 25 }, null]);
    expect(members[1].entry.isYou).toBe(true);
    expect(members[0].entry.isHost).toBe(true);
    expect(members[2].cards).toHaveLength(1);
  });

  it('grades a winner the projection gave no cards for, and counts marks only where it did', (): void => {
    const members = rosterMembers(
      {
        ...view(),
        players: [HOST, ME, OTHER],
        cards: [card(ME)],
        wins: [
          {
            winners: [OTHER],
            patterns: [[0, 1, 2, 3, 4]],
            atSeq: 12,
            rank: 1,
          },
        ],
      },
      ME,
      PROFILES,
    );
    expect(members.map(member => member.entry.status)).toEqual(['host', 'playing', 'bingo']);
    expect(members.map(member => member.entry.marks)).toEqual([null, { marked: 1, total: 25 }, null]);
  });

  it('leaves a waiting lobby without mark counts', (): void => {
    const members = rosterMembers(
      {
        ...view(),
        phase: 'Lobby',
        players: [ME],
        cards: [],
      },
      ME,
      PROFILES,
    );
    expect(members[0].entry.status).toBe('waiting');
    expect(members[0].entry.marks).toBeNull();
  });

  it('picks out the cards one player owns', (): void => {
    expect(cardsOf(running(), OTHER)).toHaveLength(1);
    expect(cardsOf(running(), WATCHER)).toEqual([]);
  });

  it('answers who is hosting and who is seated', (): void => {
    expect(isHost(view(), HOST)).toBe(true);
    expect(isHost(view(), ME)).toBe(false);
    expect(isSeated(view(), ME)).toBe(true);
    expect(isSeated(view(), OTHER)).toBe(false);
  });
});

describe('the flashboard', () => {
  it('letters one row per column range of a five-wide game', (): void => {
    const rows = flashboard([3, 20], 5);
    expect(rows).toHaveLength(5);
    expect(rows[0].letter).toBe('B');
    expect(rows[0].cells[2]).toEqual({
      value: 3,
      called: true,
      live: false,
    });
    expect(rows[1].cells[4]).toEqual({
      value: 20,
      called: true,
      live: true,
    });
    expect(rows[4].cells[14].value).toBe(75);
  });

  it('leaves the wider board unlettered', (): void => {
    const rows = flashboard([], 3);
    expect(rows).toHaveLength(3);
    expect(rows[0].letter).toBeNull();
    expect(rows[2].cells).toHaveLength(15);
  });
});

describe('the win limit', () => {
  it('says how many wins the room will wait for, in each shape the limit takes', (): void => {
    expect(winLimitLabel('Unlimited')).toBe('最後まで');
    expect(winLimitLabel('FirstOnly')).toBe('1人');
    expect(winLimitLabel({ Count: 3 })).toBe('3人');
    expect(winLimitLabel({ Count: 7 })).toBe('7人');
  });

  it('compares a counted limit by value, since two equal counts are never the same object', (): void => {
    expect(sameWinLimit({ Count: 3 }, { Count: 3 })).toBe(true);
    expect(sameWinLimit({ Count: 3 }, { Count: 5 })).toBe(false);
    expect(sameWinLimit({ Count: 3 }, 'FirstOnly')).toBe(false);
    expect(sameWinLimit('FirstOnly', { Count: 1 })).toBe(false);
    expect(sameWinLimit('Unlimited', 'Unlimited')).toBe(true);
    expect(sameWinLimit('Unlimited', 'FirstOnly')).toBe(false);
  });
});

describe('the setting labels', () => {
  it('names each choice by what it is, because the control it sits in already says what it decides', (): void => {
    expect(DAUB_LABEL.Auto).toBe('自動');
    expect(DAUB_LABEL.Manual).toBe('自分でタップ');
    expect(VISIBILITY_LABEL.Full).toBe('すべて');
    expect(VISIBILITY_LABEL.LatestOnly).toBe('最新だけ');
    expect(VISIBILITY_LABEL.Hidden).toBe('隠す');
    expect(PHASE_LABEL.Running).toBe('プレイ中');
  });
});

describe('the commitment', () => {
  it('has nothing to show before a game starts', (): void => {
    expect(commitmentText(null)).toBe('—');
  });

  it('breaks the published digest into readable runs', (): void => {
    expect(commitmentText(committedRoom().commitment)).toBe(`${'a'.repeat(16)} ${'b'.repeat(16)} cc`);
  });
});

describe('pending marks', () => {
  it('places a sent mark on the card it targets', (): void => {
    expect(
      pendingFor(
        [
          { cardIx: 0, row: 1, col: 2 },
          { cardIx: 1, row: 0, col: 0 },
        ],
        0,
        5,
      ),
    ).toEqual([7]);
  });
});

describe('winners', () => {
  it('names players that share a rank as equals and keeps their cards', (): void => {
    const finished: RoomView = {
      ...running(),
      phase: 'Finished',
      wins: [
        {
          winners: [HOST, ME],
          patterns: [[0, 1, 2, 3, 4]],
          atSeq: 12,
          rank: 1,
        },
      ],
      cards: [card(HOST), { ...card(ME), cardIx: 1 }, { ...card(OTHER), cardIx: 2 }],
    };
    expect(winnerGroups(finished, PROFILES)).toEqual([
      {
        rank: 1,
        names: 'ホストさん、🎲ぼく',
      },
    ]);
    expect(winnerCards(finished).map(won => won.cardIx)).toEqual([0, 1]);
  });

  it('has no winners to name while the game is still running', (): void => {
    expect(winnerGroups(running(), PROFILES)).toEqual([]);
    expect(winnerCards(running())).toEqual([]);
  });
});

describe('the room notice', () => {
  it('says what the connection is doing before it says anything else', (): void => {
    expect(
      noticeOf({
        ...state(),
        status: 'connecting',
      }),
    ).toBe('接続しています');
  });

  it('tells a kick, a refused join and an expiry apart, though the close code cannot', (): void => {
    const kicked = noticeOf(closed('Kicked'));
    const rejected = noticeOf(closed('Join rejected'));
    const expired = noticeOf(closed('Room expired'));
    expect(kicked).toBe('この部屋から外れました。ホストに聞いてみてください');
    expect(rejected).toBe('この部屋には入れませんでした。ホストに聞いてみてください');
    expect(expired).toBe('この部屋は時間切れで閉じました');
    expect(new Set([kicked, rejected, expired]).size).toBe(3);
  });

  it('asks for a reopen on a close it has no words for, and on one that reported nothing', (): void => {
    expect(noticeOf(closed('Some other reason'))).toBe('接続が切れました。アクティビティを開き直してください');
    expect(
      noticeOf({
        ...state(),
        status: 'closed',
      }),
    ).toBe('接続が切れました。アクティビティを開き直してください');
    expect(noticeOf(closed('Kicked'))).not.toBe('接続が切れました。アクティビティを開き直してください');
  });

  it('stays quiet while an open room has refused nothing', (): void => {
    expect(noticeOf(state())).toBeNull();
  });

  it('says every refusal the engine can raise in words the room chose', (): void => {
    expect(noticeOf(refused('NotHost'))).toBe('この操作はホストだけができます');
    expect(noticeOf(refused('NotAParticipant'))).toBe('このゲームには参加していません');
    expect(noticeOf(refused('RoomLocked'))).toBe('このゲームは締め切られています。次のゲームから参加できます');
    expect(noticeOf(refused('NumberNotDrawn'))).toBe('その番号はまだ呼ばれていません');
    expect(noticeOf(refused('NumberNotOnCard'))).toBe('その番号はカードにありません');
    expect(noticeOf(refused('NothingToUndo'))).toBe('取り消せる番号がありません');
    expect(noticeOf(refused('NoNumbersRemain'))).toBe('番号をすべて引きました');
    expect(noticeOf(refused('BacklogMarkNotAllowed'))).toBe('参加する前に呼ばれた番号はマークできません');
    expect(noticeOf(refused('NotAParticipant'))).not.toContain('操作できませんでした');
  });

  it('falls back to the protocol code for a refusal it has no words for', (): void => {
    expect(noticeOf(refused('Unheard'))).toBe('操作できませんでした（Unheard）');
  });
});
