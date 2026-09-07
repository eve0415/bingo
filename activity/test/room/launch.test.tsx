import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Launch } from '../../app/room/launch';

const marked = (html: string): number => html.match(/data-state="marked"/gu)?.length ?? 0;
const pending = (html: string): number => html.match(/data-state="pending"/gu)?.length ?? 0;

describe('the launch screen', () => {
  it('daubs one letter per wait it has finished and leaves the rest open paper', (): void => {
    const first = renderToString(<Launch step="config" />);
    expect(marked(first)).toBe(0);
    expect(pending(first)).toBe(1);
    expect(first).toContain('<p aria-hidden="true" data-bingo-launch-count="">1 / 5</p>');

    const last = renderToString(<Launch step="room" />);
    expect(marked(last)).toBe(4);
    expect(pending(last)).toBe(1);
    expect(last).toContain('<p aria-hidden="true" data-bingo-launch-count="">5 / 5</p>');
  });

  it('names each wait in the order the handshake performs them', (): void => {
    const labels = (['config', 'discord', 'identity', 'participants', 'room'] as const).map(step => {
      const found = /<p data-bingo-body="">(?<label>[^<]+)<\/p>/u.exec(renderToString(<Launch step={step} />));
      return found?.groups?.label ?? '';
    });
    expect(labels).toEqual([
      '設定を読み込んでいます。',
      'Discord につないでいます。',
      'あなたを確認しています。',
      '参加者を確認しています。',
      '部屋につないでいます。',
    ]);
  });

  it('spells the word out of the card itself, so a step carries no blot before it is reached', (): void => {
    const html = renderToString(<Launch step="identity" />);
    // Every letter is printed from the first frame; the daub overprints it, exactly as it does on a real card.
    expect(html).toContain('<span data-bingo-num="">B</span>');
    expect(html).toContain('<span data-bingo-num="">O</span>');
    // Two landed, one running, and the last two are cells with nothing in them yet.
    expect(html.match(/data-bingo-blot/gu)).toHaveLength(3);
  });

  it('gives a notice the place the step label would have had', (): void => {
    const html = renderToString(<Launch notice="接続が切れました" step="room" />);
    expect(html).toContain('<p data-bingo-body="">接続が切れました</p>');
    expect(html).not.toContain('部屋につないでいます。');
    // The count still says where the launch got to.
    expect(html).toContain('<p aria-hidden="true" data-bingo-launch-count="">5 / 5</p>');
  });

  it('announces itself once, as a status rather than an alert', (): void => {
    const html = renderToString(<Launch step="discord" />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    // The strip, not the visible fraction, is what carries progress to assistive technology.
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuetext="5つのうち2つめ"');
    expect(html).toContain('aria-valuenow="2"');
    // Only the line that changed should speak; the title is the same on every step.
    expect(html).toContain('aria-atomic="false"');
  });
});
