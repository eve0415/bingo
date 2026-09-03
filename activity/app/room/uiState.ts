/** What the room is showing over the board. Kept apart from the game so that a snapshot arriving mid-decision cannot close a dialogue under the host. */
export type Overlay =
  | { readonly kind: 'card'; readonly player: string }
  | { readonly kind: 'kick'; readonly player: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'roster' }
  | null;

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
