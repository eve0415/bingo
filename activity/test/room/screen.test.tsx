import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from '../../app/room/button';
import { Dialog, Note, Notice, ReachNote, Reserved, Screen, Sheet, Wordmark } from '../../app/room/screen';

import { clickEveryAction } from './fixture';

describe('the screen shell', () => {
  it('keeps a footer and an overlay slot even when the screen has neither', (): void => {
    const html = renderToString(<Screen header={<Wordmark players={4} status="プレイ中" />}>本文</Screen>);
    expect(html).toContain('<footer data-bingo-footer=""></footer>');
    expect(html).toContain('<main data-bingo-main="">本文</main>');
    expect(html).toContain('data-edge="base"');
    expect(html).not.toContain('inert');
    expect(html).toContain('<span data-bingo-players="">4<!-- -->人</span>');
    expect(html).toContain('<span data-bingo-status="">· <!-- -->プレイ中</span>');
    expect(html).toContain('<h1 data-bingo-title="">Bingo</h1>');
  });

  it('counts the room without reporting a phase the lobby has nothing to add to', (): void => {
    const html = renderToString(<Wordmark players={1} />);
    expect(html).toContain('<span data-bingo-players="">1<!-- -->人</span>');
    expect(html).not.toContain('data-bingo-status');
  });

  it('hangs the overlay outside the frame that must not scroll', (): void => {
    const html = renderToString(
      <Screen edge="tight" footer={<span data-footer="">下</span>} header="頭" overlay={<span data-overlay="">上</span>}>
        本文
      </Screen>,
    );
    expect(html).toContain('data-edge="tight"');
    expect(html).toContain('<header data-bingo-header="" inert="">頭</header>');
    expect(html).toContain('<main data-bingo-main="" inert="">本文</main>');
    expect(html).toContain('<footer data-bingo-footer="" inert=""><span data-footer="">下</span></footer>');
    expect(html).toContain('<span data-overlay="">上</span></div>');
  });

  it('leaves the header empty on a screen that gives its height to the game', (): void => {
    const bare = renderToString(<Screen>本文</Screen>);
    expect(bare).toContain('<header data-bingo-header=""></header>');
    expect(bare).not.toContain('inert');
  });
});

describe('reserved space', () => {
  it('holds its slot open whether or not it has anything to say', (): void => {
    expect(renderToString(<Reserved slot="toast">お知らせ</Reserved>)).toBe('<div aria-live="polite" data-bingo-reserved="" data-slot="toast">お知らせ</div>');
    expect(renderToString(<ReachNote reach />)).toContain('リーチ · あと1つ');
    expect(renderToString(<ReachNote reach={false} />)).toBe('<div aria-live="polite" data-bingo-reserved="" data-slot="reach"></div>');
  });
});

describe('the empty-state note', () => {
  it('gives every "nothing to show yet" state the same shape', (): void => {
    expect(renderToString(<Note body="このアクティビティを開いた人から、順にここへ並びます。" title="まだあなただけです" />)).toBe(
      '<div data-bingo-note=""><p data-bingo-note-title="">まだあなただけです</p><p data-bingo-body="">このアクティビティを開いた人から、順にここへ並びます。</p></div>',
    );
    expect(
      renderToString(
        <Note body="本文" title="見出し">
          {<span data-extra="">おまけ</span>}
        </Note>,
      ),
    ).toContain('<span data-extra="">おまけ</span></div>');
  });
});

describe('the room notice', () => {
  it('keeps its row whether or not the room has refused anything', (): void => {
    expect(renderToString(<Notice notice={null} />)).toBe('<div aria-live="polite" data-bingo-reserved="" data-slot="toast"></div>');
    const html = renderToString(<Notice notice="この操作はホストだけができます" />);
    expect(html).toContain('<span aria-hidden="true" data-bingo-toast-dot=""></span>');
    expect(html).toContain('この操作はホストだけができます');
  });
});

describe('the roster sheet', () => {
  it('closes from the scrim and from its own control, and not from inside itself', (): void => {
    const dismissed: string[] = [];
    const sheet = (
      <Sheet
        onDismiss={(): void => {
          dismissed.push('dismissed');
        }}
        title="参加者 · 4人"
      >
        <p>中身</p>
      </Sheet>
    );
    const html = renderToString(sheet);
    expect(html).toContain('aria-label="参加者 · 4人" aria-modal="true"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<h2 data-bingo-label="">参加者 · 4人</h2>');
    expect(html).toContain('<div data-bingo-surface="sheet" tabindex="-1">');
    expect(html).toContain('<p>中身</p>');

    clickEveryAction(sheet);
    expect(dismissed).toEqual(['dismissed', 'dismissed']);
  });
});

describe('the confirmation dialogue', () => {
  it('confirms a decision on its own surface', (): void => {
    const chosen: string[] = [];
    const dialog = (
      <Dialog
        actions={
          <Button
            onClick={(): void => {
              chosen.push('confirmed');
            }}
            variant="danger"
          >
            終了する
          </Button>
        }
        onDismiss={(): void => {
          chosen.push('dismissed');
        }}
        title="ゲームを終了しますか"
      >
        <p data-bingo-body="">本文</p>
      </Dialog>
    );
    const html = renderToString(dialog);
    expect(html).toContain('<h2 data-bingo-dialog-title="">ゲームを終了しますか</h2>');
    expect(html).toContain('<div data-bingo-dialog-actions="">');
    expect(html).toContain('<div data-bingo-surface="dialog" tabindex="-1">');

    clickEveryAction(dialog);
    expect(chosen).toEqual(['dismissed', 'confirmed']);
  });

  it('carries a status beside the title when the decision is about a person', (): void => {
    const html = renderToString(
      <Dialog actions={null} aside={<span data-aside="">状態</span>} onDismiss={(): void => undefined} title="ぼくのカード">
        <p>本文</p>
      </Dialog>,
    );
    expect(html).toContain('<span data-aside="">状態</span></div>');
  });
});
