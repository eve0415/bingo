/** What the room is showing over the board. Kept apart from the game so that a snapshot arriving mid-decision cannot close a dialogue under the host. */
export type Overlay =
  | { readonly kind: 'card'; readonly player: string }
  | { readonly kind: 'kick'; readonly player: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'roster' }
  /** The lobby's per-row overflow menu. It sits in the row rather than over the screen, so it is the one kind that leaves the rest of the page live. */
  | { readonly kind: 'menu'; readonly player: string }
  | { readonly kind: 'promote'; readonly player: string }
  | null;

export type OverlayKind = NonNullable<Overlay>['kind'];

/** On a phone the host's three reference panels cannot stack, so one is shown at a time. */
export type Panel = 'board' | 'roster' | 'card';

export interface UiState {
  readonly overlay: Overlay;
  readonly panel: Panel;
}

export type UiAction =
  | { readonly type: 'open'; readonly overlay: NonNullable<Overlay> }
  | { readonly type: 'dismiss' }
  | { readonly type: 'panel'; readonly panel: Panel };

export type HostOverlayKind = Extract<NonNullable<Overlay>, { kind: 'card' | 'close' | 'kick' }>;

/**
 * Every overlay kind, and whether the host's own screen is what owns it. The host's screen goes inert behind whatever it is handed,
 * so an overlay that outlives the screen which opened it — the lobby's roster menu, once handing the room over has made this client a player —
 * would leave a running game inert with nothing drawn on top of it. Naming all of them rather than the ones to keep out is what makes
 * a kind added later a compile error here instead of that.
 */
const HOST_OWNED = {
  card: true,
  kick: true,
  close: true,
  menu: false,
  promote: false,
  roster: false,
} as const satisfies Record<OverlayKind, boolean>;

const ownedByHost = (overlay: NonNullable<Overlay>): overlay is HostOverlayKind => HOST_OWNED[overlay.kind];

export const hostOverlay = (overlay: Overlay): HostOverlayKind | null => (overlay !== null && ownedByHost(overlay) ? overlay : null);

export const initialUi: UiState = {
  overlay: null,
  panel: 'board',
};

export const uiReducer = (state: UiState, action: UiAction): UiState => {
  if (action.type === 'open') {
    return {
      ...state,
      overlay: action.overlay,
    };
  }
  if (action.type === 'dismiss') {
    return {
      ...state,
      overlay: null,
    };
  }
  return {
    ...state,
    panel: action.panel,
  };
};
