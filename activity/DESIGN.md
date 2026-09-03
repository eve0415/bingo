# Bingo Design

## Overview

Bingo is a party game for a Discord voice call — a 忘年会, a family gathering — played by people who are half paying attention. It runs as a Discord Activity: an iframe on phone and desktop, framed by chrome the app cannot see and cannot query.

The thesis: **the player's card is an ordinary bingo card**. Not a stylised interpretation of one — the object people already know how to use, rendered honestly. Fixed grid, FREE centre, numbers where they belong. The reference is a printed bingo card on a table under a hall light, next to the caller's flashboard.

The interface is Japanese. Tone is a friendly host at a party, not a game show: short, plain, present tense, です／ます, no 敬語 escalation, no emoji, and at most one 「！」— which is why there is none.

## Colors

Two grounds. Discord ships Light, Dark, Midnight, Ash and Nitro themes and gives no reliable signal about which is active, so the app paints its own full-bleed ground rather than borrowing contrast from the frame: a hued deep slate that reads as a decision against both a near-white and a near-black host. The card is cool white paper sitting on that ground with one shadow.

One accent — `--live`, a lime — and it is reserved for the number currently being called and for focus rings. Nothing else wears it. Daub ink is a saturated blue chosen so a blot stays dark against paper in greyscale. Reach is a pale amber with a dashed edge; a win is a warm red-orange ring plus a bar struck through the line. Semantic colours never appear as large fills except the live call.

Tokens live in `app/theme.css`; that file is the letter of this section.

## Typography

Barlow Semi Condensed for numerals and Latin UI, self-hosted, four Latin weights (~91 KB). Its condensed width is what lets two digits sit inside a 44px cell at 9×9. Japanese falls through to the platform face — the licensed webfont is ~1 MB per weight, which is more than a party activity should download to set body text.

Numerals are the hero: the called number is 104px on a phone; cell numbers are 28/22/17px at 5/7/9. Body is 16px at line-height 1.7. Labels are 14px medium with 0.02em tracking. The only capitals are the B-I-N-G-O column letters and the word FREE, both at 0.1em — they are part of the card, not of the interface.

## Layout

4px base scale. Cell gaps 6/4/3px by board size; card padding 12px; the card never exceeds 560px.

Arrangement is chosen from the frame the activity is actually measured at, never from a device breakpoint — Discord hands it a phone, a landscape phone, a laptop pane and an ultra-wide. `app/room/layout.ts` picks between a phone **stack** (call above card), a landscape **row** (call beside a height-limited card) and a **desk** with a 320px rail.

Two rules govern the running game and outrank everything else in this section:

- **Nothing scrolls.** The player's frame is one screen that fits. The card is sized by giving things up in order — the call history first, then the hero call box for a compact one — and never by dropping below a 44px cell pitch. Two frames are too small even for that, and both scroll rather than clip, because a clipped card is the worse defect: a large board on a narrow phone scrolls horizontally inside its own paper, and a frame with no room for a full-pitch card scrolls its card area.
- **Nothing shifts.** Everything that appears or changes — the called number, the reach line, a connection notice — occupies space reserved for its largest occupant. A card that moves under a thumb mid-tap is a defect, not a polish item.

## Elevation

One shadow language. `--shadow-card` under the card, `--shadow-raised` under the called-number box and the notes that sit on the ground. Nothing else casts a shadow. Overlays use a solid 80% scrim of the app's own ground — never a blur.

## Shapes

Cells 6px, card 12px, buttons 10px, hero call box 16px, chips pill. Cell borders are a 1.5px hairline; controls on the ground use fill rather than border, except ghost buttons.

## Components

- **Cell state is shape as well as colour.** A mark is an irregular ink blot, rotated by a per-index angle, overprinting the number in paper-white. Pending is that blot as a dotted outline that breathes — never a spinner. Reach is a dashed 2px amber edge on the _open_ cell that would complete the line, because that is the cell the player is waiting for. Every state reads in greyscale and under forced colours, which `app/theme.css` re-declares against the same `data-bingo-*` attributes the components carry.
- **Appearance lives in CSS, not in JSX.** Components carry semantics and `data-bingo-*` attributes; hover, press and focus are real CSS states rather than inline style mutations. This is a deliberate departure from the source design system's inline-style components — the rendered result is identical and the states are testable.
- **Status chips carry a glyph** (◇ waiting, ● playing, ◆ reach, ★ bingo, ▲ host) so the roster reads without colour.
- **The host and the player get different screens.** A player sees the call and their own card and nothing that competes with them. The host reads a flashboard, a roster with reach and bingo counts, any player's card on demand, and their own card if they took one; drawing is their one primary action.
- **There is no logo.** Where a mark would go, the word "Bingo" is set in plain type. There is no room code either — the room is the Discord call everyone is already in.

## Do's and Don'ts

- **Don't** reinterpret the grid, or add chrome that competes with the card.
- **Don't** explain bingo to anyone who has played bingo.
- **Don't** design to the 24px touch floor. 44px minimum, with real gaps between cells: tapping a cell decides who wins.
- **Don't** use gradients, imagery, texture, blur, or transparency. Backgrounds are flat colour; the card is the only object with a shadow.
- **Don't** use emoji anywhere, and don't write celebration copy — the strike bar through the completed line is the celebration.
- **Don't** let a control label wrap. Labels are `white-space: nowrap` and must fit at 375px.
- **Do** reserve space for anything that can appear, and size the reservation to its largest occupant.
- **Do** keep motion between 120 and 320ms, ease-out; a daub lands with a small overshoot, the called number is replaced in place, and reduced motion sets every duration to zero.
