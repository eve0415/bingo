import type { Arrowing } from '../../app/room/arrows';

import { describe, expect, it } from 'vitest';

import { arrowFocus, escapeToToggle } from '../../app/room/arrows';

type Control = Arrowing['currentTarget'] & { readonly focus: () => void };

/** A row of controls that record being focused, each pointing back at the row, which is the whole of what the helper reads. */
const row = (count: number): { readonly children: Control[]; readonly focused: number[]; readonly parent: { children: unknown[] } } => {
  const focused: number[] = [];
  const children: unknown[] = [];
  const parent = {
    children,
  };
  const controls = Array.from({ length: count }, (_unused, index): Control => ({
    focus: (): void => {
      focused.push(index);
    },
    parentElement: parent,
  }));
  children.push(...controls);
  return {
    children: controls,
    focused,
    parent,
  };
};

/** Presses a key on one control and reports whether the helper claimed it. */
const press = (key: string, current: Arrowing['currentTarget']): number => {
  let prevented = 0;
  arrowFocus({
    key,
    currentTarget: current,
    preventDefault: (): void => {
      prevented += 1;
    },
  });
  return prevented;
};

describe('arrow keys along a row of controls', () => {
  it('moves to the next control and wraps round both ends', (): void => {
    const { children, focused } = row(3);
    press('ArrowDown', children[0]);
    press('ArrowRight', children[2]);
    press('ArrowUp', children[0]);
    press('ArrowLeft', children[1]);
    expect(focused).toEqual([1, 0, 2, 0]);
  });

  it('leaves every other key to the control it was pressed on', (): void => {
    const { children, focused } = row(3);
    // The key was never ours, so the button underneath still has to receive it.
    expect(press('Enter', children[0])).toBe(0);
    expect(focused).toEqual([]);
  });

  it('claims the key once it has somewhere to send it', (): void => {
    const { children } = row(2);
    expect(press('ArrowDown', children[0])).toBe(1);
  });

  it('does nothing where there is no row to move along', (): void => {
    expect(press('ArrowDown', { parentElement: null })).toBe(0);
    expect(press('ArrowDown', { parentElement: { children: [] } })).toBe(0);
  });

  it('enters the row at its head when the control pressed is not one of its own', (): void => {
    const { focused, parent } = row(3);
    press('ArrowDown', { parentElement: parent });
    expect(focused).toEqual([0]);
  });

  it('does nothing when the neighbour is not something that takes focus', (): void => {
    const { children, focused, parent } = row(2);
    parent.children.splice(1, 0, 'a text node');
    press('ArrowDown', children[0]);
    expect(focused).toEqual([]);
  });
});

describe('escape out of a menu', () => {
  it('closes it and puts focus back on the control that opened it', (): void => {
    const { children, focused, parent } = row(2);
    let closed = 0;
    let prevented = 0;
    escapeToToggle(
      {
        key: 'Escape',
        currentTarget: {
          parentElement: parent,
        },
        preventDefault: (): void => {
          prevented += 1;
        },
      },
      (): void => {
        closed += 1;
      },
    );
    expect(closed).toBe(1);
    expect(prevented).toBe(1);
    // The control that opened the menu is the first in the row the menu sits in.
    expect(focused).toEqual([0]);
    expect(children).toHaveLength(2);
  });

  it('leaves every other key alone', (): void => {
    const { focused, parent } = row(2);
    let closed = 0;
    escapeToToggle(
      {
        key: 'ArrowDown',
        currentTarget: {
          parentElement: parent,
        },
        preventDefault: (): void => undefined,
      },
      (): void => {
        closed += 1;
      },
    );
    expect(closed).toBe(0);
    expect(focused).toEqual([]);
  });

  it('still closes where there is nothing to hand focus back to', (): void => {
    let closed = 0;
    const escape = (parentElement: { readonly children: Iterable<unknown> } | null): void => {
      escapeToToggle(
        {
          key: 'Escape',
          currentTarget: {
            parentElement,
          },
          preventDefault: (): void => undefined,
        },
        (): void => {
          closed += 1;
        },
      );
    };
    escape(null);
    escape({ children: ['a text node'] });
    expect(closed).toBe(2);
  });
});
