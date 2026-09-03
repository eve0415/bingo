import type { JSX, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'paper';
export type ButtonSize = 'md' | 'lg';

/**
 * Appearance lives in the stylesheet keyed on these attributes rather than in inline styles, so hover, press and focus are real CSS states.
 * The same attributes are what forced-colors mode re-declares against.
 */
export const Button = ({
  children,
  variant,
  focus = false,
  size = 'md',
  block = false,
  disabled = false,
  label,
  pressed,
  onClick,
}: {
  children: ReactNode;
  variant: ButtonVariant;
  focus?: boolean;
  size?: ButtonSize;
  block?: boolean;
  disabled?: boolean;
  label?: string;
  pressed?: boolean;
  onClick?: () => void;
}): JSX.Element => (
  <button
    aria-label={label}
    aria-pressed={pressed}
    autoFocus={focus}
    data-bingo-button=""
    data-block={block}
    data-size={size}
    data-variant={variant}
    disabled={disabled}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);
