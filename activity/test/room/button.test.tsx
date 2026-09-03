import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from '../../app/room/button';

import { clickEveryAction } from './fixture';

describe('the room button', () => {
  it('carries its appearance on attributes the stylesheet keys on', (): void => {
    const html = renderToString(<Button variant="ghost">閉じる</Button>);
    expect(html).toContain('data-bingo-button=""');
    expect(html).toContain('data-block="false"');
    expect(html).toContain('data-size="md"');
    expect(html).toContain('data-variant="ghost"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-pressed');
    expect(html).not.toContain('autofocus');
  });

  it('announces a pressed, blocked, full-width control', (): void => {
    const html = renderToString(
      <Button block disabled focus label="番号を引く" pressed size="lg" variant="primary">
        引く
      </Button>,
    );
    expect(html).toContain('aria-label="番号を引く"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-block="true"');
    expect(html).toContain('data-size="lg"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('autofocus=""');
  });

  it('reports a press to its caller', (): void => {
    const presses: string[] = [];
    clickEveryAction(
      <Button
        onClick={(): void => {
          presses.push('pressed');
        }}
        variant="danger"
      >
        終了する
      </Button>,
    );
    expect(presses).toEqual(['pressed']);
  });
});
