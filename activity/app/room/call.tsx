import type { JSX } from 'react';

export interface CalledEntry {
  readonly value: number;
  readonly letter: string | null;
}

const Value = ({ entry }: { entry: CalledEntry | null }): JSX.Element =>
  entry === null ? (
    <span data-bingo-num="">—</span>
  ) : (
    <>
      {entry.letter === null ? null : <span data-bingo-letter="">{entry.letter}</span>}
      <span data-bingo-num="">{entry.value}</span>
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
  variant = 'hero',
}: {
  latest: CalledEntry | null;
  progress: string;
  history?: readonly CalledEntry[];
  variant?: 'hero' | 'compact';
}): JSX.Element => (
  <div data-bingo-call="" data-variant={variant}>
    <div data-bingo-call-box="">
      <span data-bingo-call-label="">いまの番号</span>
      <span data-bingo-call-progress="">{progress}</span>
      <div aria-atomic="true" aria-live="polite" data-bingo-call-value="">
        <span data-bingo-call-swap="" key={latest === null ? 'idle' : latest.value}>
          <Value entry={latest} />
        </span>
      </div>
    </div>
    {history === undefined ? null : (
      <div aria-label="呼ばれた番号" data-bingo-history="" role="group" tabIndex={0}>
        {history.map(entry => (
          <span data-bingo-history-item="" key={entry.value}>
            <Value entry={entry} />
          </span>
        ))}
      </div>
    )}
  </div>
);
