import type { BootStep } from '../discord';
import type { JSX } from 'react';

import { LETTERS } from './lines';
import { Screen } from './screen';

/** The waits a launch performs, in the order it performs them; one per letter, so the strip cannot outgrow the word. */
const STEPS = ['config', 'discord', 'identity', 'participants', 'room'] as const satisfies readonly BootStep[];

/** What each wait is called in the room's own voice: what is happening, not what the code is doing. */
const LABEL = {
  config: '設定を読み込んでいます。',
  discord: 'Discord につないでいます。',
  identity: 'あなたを確認しています。',
  participants: '参加者を確認しています。',
  room: '部屋につないでいます。',
} as const satisfies Record<BootStep, string>;

/** A finished step is a landed daub, the running one is the pending blot, and a step not reached yet is open paper. */
const stateOf = (letter: number, running: number): 'marked' | 'pending' | undefined => {
  if (letter < running) return 'marked';
  if (letter === running) return 'pending';
  return undefined;
};

/**
 * The launch screen is the card's own vocabulary put to work as a progress bar: the word fills as the room
 * answers, so the one thing on screen is the object the game is played on rather than a spinner.
 */
export const Launch = ({ notice = null, step }: { notice?: string | null; step: BootStep }): JSX.Element => {
  const running = STEPS.indexOf(step);
  return (
    <Screen>
      <div data-bingo-launch="">
        <div aria-atomic="false" aria-live="polite" data-bingo-launch-status="" role="status">
          <div data-bingo-launch-progress="">
            <div
              aria-valuemax={STEPS.length}
              aria-valuemin={1}
              aria-valuenow={running + 1}
              aria-valuetext={`${STEPS.length}つのうち${running + 1}つめ`}
              data-bingo-card=""
              data-bingo-launch-strip=""
              role="progressbar"
            >
              {/* Walked by wait rather than by letter, so a sixth step would show as a sixth cell instead of silently losing its own. */}
              {STEPS.map((wait, index) => {
                const state = stateOf(index, running);
                return (
                  <span data-bingo-cell="" data-state={state} key={wait}>
                    {state === undefined ? null : <span data-bingo-blot="" />}
                    <span data-bingo-num="">{LETTERS[index]}</span>
                  </span>
                );
              })}
            </div>
            <div aria-hidden="true" data-bingo-launch-track="">
              <span data-bingo-launch-sweep="" />
            </div>
          </div>
          <div data-bingo-launch-copy="">
            <h1 data-bingo-launch-title="">参加しています</h1>
            <p data-bingo-body="">{notice ?? LABEL[step]}</p>
            <p aria-hidden="true" data-bingo-launch-count="">{`${running + 1} / ${STEPS.length}`}</p>
          </div>
        </div>
      </div>
    </Screen>
  );
};
