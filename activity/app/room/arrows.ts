/** Which way an arrow key moves along a set of controls. A menu runs down the page and a segmented control across it, and both accept either pair. */
const ARROW = new Map([
  ['ArrowDown', 1],
  ['ArrowRight', 1],
  ['ArrowUp', -1],
  ['ArrowLeft', -1],
]);

/**
 * The part of a keyboard event this needs, stated structurally so a test can hand it an object rather than a DOM there is none of.
 * A real React keyboard event satisfies it.
 */
export interface Arrowing {
  readonly key: string;
  readonly currentTarget: { readonly parentElement: { readonly children: Iterable<unknown> } | null };
  preventDefault: () => void;
}

const focusable = (node: unknown): node is { focus: () => void } =>
  typeof node === 'object' && node !== null && 'focus' in node && typeof node.focus === 'function';

/** Focuses the first control in a row, which is where a menu hands focus back to the button that opened it. */
const focusFirst = (parent: { readonly children: Iterable<unknown> } | null): void => {
  if (parent === null) return;
  const [first] = parent.children;
  if (focusable(first)) first.focus();
};

/**
 * Moves focus to the neighbouring control, wrapping at both ends.
 * This is the half of a menu's keyboard contract that markup cannot state: `role="menu"` promises the arrow keys work,
 * and a set of buttons that only answers Tab is a promise the page does not keep.
 * It walks the control's own siblings rather than a list of its own, so what it moves between is exactly what was drawn.
 */
export const arrowFocus = (event: Arrowing): void => {
  const by = ARROW.get(event.key);
  if (by === undefined) return;
  const parent = event.currentTarget.parentElement;
  if (parent === null) return;
  const siblings = [...parent.children];
  if (siblings.length === 0) return;
  event.preventDefault();
  const here = siblings.indexOf(event.currentTarget);
  const node = siblings[(here + by + siblings.length) % siblings.length];
  if (focusable(node)) node.focus();
};

/**
 * Escape closes a menu, and closing it has to put focus back on the button that opened it — a menu that leaves focus on
 * nothing has taken the keyboard somewhere the page cannot get it back from. The toggle is the first child of the anchor
 * the menu sits in, so the way back is the same walk the arrow keys take.
 */
export const escapeToToggle = (event: Arrowing, dismiss: () => void): void => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  dismiss();
  focusFirst(event.currentTarget.parentElement);
};
