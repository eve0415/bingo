import type { JSX } from 'react';

export interface CalledEntry {
  readonly value: number;
  readonly letter: string | null;
}

// The shuffled digits are decorative; the live region always reads the actual call.
const RollingNumber = ({ value }: { value: number }): JSX.Element => (
  <>
    <span data-bingo-call-result="">{value}</span>
    <span aria-hidden="true" data-bingo-reel="">
      {Array.from(String(value), (digit, index) => (
        <span data-bingo-reel-window="" key={index}>
          <span data-bingo-reel-track="">
            {[7, 3, 9, 1, 0].map(offset => (
              <span key={offset}>{(Number(digit) + offset) % 10}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  </>
);

const Value = ({ entry, animate = false }: { entry: CalledEntry | null; animate?: boolean }): JSX.Element =>
  entry === null ? (
    <span data-bingo-num="">—</span>
  ) : (
    <>
      {entry.letter === null ? null : <span data-bingo-letter="">{entry.letter}</span>}
      <span data-bingo-num="">{animate ? <RollingNumber value={entry.value} /> : entry.value}</span>
    </>
  );

/**
 * The box is sized to its largest occupant and the number is replaced inside it, so a new call never moves the card underneath.
 * The history strip is reserved the same way: passing a list keeps its row whether or not there is anything in it yet, because the second draw must not push the card down.
 */
export const CalledNumber = ({
  latest,
  progress,
  history,
  idle,
  recent,
  variant = 'hero',
}: {
  latest: CalledEntry | null;
  progress: string;
  history?: readonly CalledEntry[];
  /** The last few calls, kept inside the box where there is no room for a strip under it. */
  recent?: readonly CalledEntry[];
  /** What the reserved strip says while it is still empty. Only the screen that draws has a sentence to put there, so it is the caller who supplies one. */
  idle?: string;
  variant?: 'hero' | 'compact';
}): JSX.Element => (
  <div data-bingo-call="" data-variant={variant}>
    <div data-bingo-call-box="">
      <span data-bingo-call-label="">いまの番号</span>
      <span data-bingo-call-progress="">{progress}</span>
      <div aria-atomic="true" aria-live="polite" data-bingo-call-value="">
        <span data-bingo-call-swap="" key={latest === null ? 'idle' : latest.value}>
          <Value animate entry={latest} />
        </span>
      </div>
      {recent === undefined ? null : (
        <div aria-label="呼ばれた番号" data-bingo-recent="" role="group">
          {recent.map(entry => (
            <span data-bingo-recent-item="" key={entry.value}>
              {entry.value}
            </span>
          ))}
        </div>
      )}
    </div>
    {history === undefined ? null : (
      <div aria-label="呼ばれた番号" data-bingo-history="" role="group" tabIndex={0}>
        {/* The strip holds what came before the current call, so it is empty on the first draw too — and under a restricted view for the whole game. What decides the sentence is whether anything has been called at all. */}
        {latest === null && idle !== undefined ? <span data-bingo-history-idle="">{idle}</span> : null}
        {history.map(entry => (
          <span data-bingo-history-item="" key={entry.value}>
            <Value entry={entry} />
          </span>
        ))}
      </div>
    )}
  </div>
);
