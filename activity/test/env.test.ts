import { describe, expect, it } from 'vitest';

import { configured } from '../app/env';

describe('configured', () => {
  it('maps absent and empty bindings to null', (): void => {
    const environment: { binding?: string } = {};
    expect(configured(environment.binding)).toBeNull();
    expect(configured('')).toBeNull();
  });

  it('preserves a configured binding', (): void => {
    expect(configured('configured')).toBe('configured');
  });
});
