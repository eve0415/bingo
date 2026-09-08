import type { Edge } from './layout';
import type { Panel } from './uiState';
import type { JSX, ReactNode } from 'react';

import { Button } from './button';

/**
 * Every screen is one frame that fits: the shell owns Discord's safe-area insets and refuses to scroll,
 * so a draw arriving mid-tap can never move the card under a thumb.
 */
export const Screen = ({
  children,
  edge = 'base',
  footer,
  header,
  overlay = null,
}: {
  children: ReactNode;
  edge?: Edge;
  footer?: ReactNode;
  header?: ReactNode;
  overlay?: ReactNode;
}): JSX.Element => {
  // An aria-modal scrim hides what is behind it from assistive technology, so what is behind it must leave the tab order too.
  const behind = overlay === null ? undefined : true;
  return (
    <div data-bingo-screen="" data-edge={edge}>
      <header data-bingo-header="" inert={behind}>
        {header}
      </header>
      <main data-bingo-main="" inert={behind}>
        {children}
      </main>
      <footer data-bingo-footer="" inert={behind}>
        {footer}
      </footer>
      {overlay}
    </div>
  );
};

/**
 * The system has no logo, so the mark is the word set in plain type; the room itself is the Discord call everyone is already in.
 * The lobby has nothing to report beside the count, so the status is what a screen adds rather than what every screen carries.
 */
export const Wordmark = ({ players, status }: { players: number; status?: string }): JSX.Element => (
  <div data-bingo-wordmark="">
    <h1 data-bingo-title="">Bingo</h1>
    {/* Keyed on the count so a change restarts the tick in place, the way the called number is replaced inside its own box. */}
    <span data-bingo-players="" key={players}>
      {players}人
    </span>
    {status === undefined ? null : <span data-bingo-status="">· {status}</span>}
  </div>
);

/** One segment of the switcher: which panel it shows, what it is called, and the tally it is worth carrying on the segment itself. */
export interface PanelTab {
  readonly panel: Panel;
  readonly label: string;
  readonly count?: number;
}

/**
 * One control with segments rather than a button each: which panel is showing is said by the pressed state alone, and the track is what makes them one thing.
 * Which segments there are belongs to the screen, because a frame too narrow to hold the panels side by side is the only reason any screen has them.
 */
export const Tabs = ({ current, onPanel, panels }: { current: Panel; onPanel: (panel: Panel) => void; panels: readonly PanelTab[] }): JSX.Element => (
  <div data-bingo-tabs="">
    {panels.map(entry => (
      <Button
        key={entry.panel}
        onClick={() => {
          onPanel(entry.panel);
        }}
        pressed={current === entry.panel}
        variant="primary"
      >
        {entry.label}
        {entry.count === undefined ? null : <span data-bingo-tab-count="">{entry.count}</span>}
      </Button>
    ))}
  </div>
);

export const Reserved = ({ children, slot }: { children: ReactNode; slot: 'reach' | 'toast' }): JSX.Element => (
  <div aria-live="polite" data-bingo-reserved="" data-slot={slot}>
    {children}
  </div>
);

/** The shape every "nothing to show yet" state takes, so five of them cannot drift apart. */
export const Note = ({ body, children, title }: { body: string; children?: ReactNode; title: string }): JSX.Element => (
  <div data-bingo-note="">
    <p data-bingo-note-title="">{title}</p>
    <p data-bingo-body="">{body}</p>
    {children}
  </div>
);

/** Whatever the room last refused, said where the person who triggered it is looking. */
export const Notice = ({ notice }: { notice: string | null }): JSX.Element => (
  <Reserved slot="toast">
    {notice === null ? null : (
      <span data-bingo-toast="">
        <span aria-hidden="true" data-bingo-toast-dot="" />
        {/* The pill is a flex line, and an ellipsis is something a block container does to its own text, so the sentence carries its own box. */}
        <span data-bingo-toast-text="">{notice}</span>
      </span>
    )}
  </Reserved>
);

/** Reach is the one thing worth calling out mid-game, and it occupies its space whether or not it has anything to say. */
export const ReachNote = ({ reach }: { reach: boolean }): JSX.Element => (
  <Reserved slot="reach">
    {reach ? (
      <span data-bingo-reach="">
        <span aria-hidden="true">◆</span> リーチ · あと1つ
      </span>
    ) : null}
  </Reserved>
);

/** The roster is worth a look, never worth the card's space, so on a phone it arrives over the game and leaves it untouched. */
const Scrim = ({
  children,
  onDismiss,
  surface,
  title,
}: {
  children: ReactNode;
  onDismiss: () => void;
  surface: 'sheet' | 'dialog';
  title: string;
}): JSX.Element => (
  <div aria-label={title} aria-modal="true" data-bingo-scrim="" onClick={onDismiss} role="dialog">
    <div
      data-bingo-surface={surface}
      onClick={event => {
        event.stopPropagation();
      }}
      tabIndex={-1}
    >
      {children}
    </div>
  </div>
);

export const Sheet = ({ children, onDismiss, title }: { children: ReactNode; onDismiss: () => void; title: string }): JSX.Element => (
  <Scrim onDismiss={onDismiss} surface="sheet" title={title}>
    <>
      <div data-bingo-sheet-head="">
        <h2 data-bingo-label="">{title}</h2>
        <Button onClick={onDismiss} variant="ghost">
          閉じる
        </Button>
      </div>
      {children}
    </>
  </Scrim>
);

/** A decision that removes someone from the room, or ends the game, is confirmed on its own surface rather than under a thumb on the board. */
export const Dialog = ({
  actions,
  aside,
  children,
  onDismiss,
  title,
}: {
  actions: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  onDismiss: () => void;
  title: string;
}): JSX.Element => (
  <Scrim onDismiss={onDismiss} surface="dialog" title={title}>
    <>
      <div data-bingo-dialog-head="">
        <h2 data-bingo-dialog-title="">{title}</h2>
        {aside}
      </div>
      {children}
      <div data-bingo-dialog-actions="">{actions}</div>
    </>
  </Scrim>
);
