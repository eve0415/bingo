import type { RoomState } from '../../app/room/connection';
import type { ProfileLookup } from '../../app/room/profiles';
import type { UiAction, UiState } from '../../app/room/uiState';
import type { CardViewDto } from '@bingo/wasm/CardViewDto';
import type { ConfigDto } from '@bingo/wasm/ConfigDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { ClientMessage, RoomInfo, RoomView } from '@bingo/wrapper/protocol';
import type { ReactNode } from 'react';

import { playerKey } from '@bingo/wrapper/identity';
import { Children, isValidElement } from 'react';

import { initialRoomState } from '../../app/room/connection';

export const HOST: PlayerIdDto = {
  issuer: 'discord',
  subject: 'host-0001',
};
export const ME: PlayerIdDto = {
  issuer: 'discord',
  subject: 'me-0002',
};
export const OTHER: PlayerIdDto = {
  issuer: 'discord',
  subject: 'other-0003',
};

/** The roster keys players the way the room does, which is what an overlay names when it is asked to show one player's card. */
export const KEYS = {
  host: playerKey(HOST),
  me: playerKey(ME),
  other: playerKey(OTHER),
};

/** The host and this player are reported by the Discord instance; the third is not, so the roster falls back for both their name and their picture. */
export const PROFILES: ProfileLookup = new Map([
  [
    playerKey(HOST),
    {
      name: 'ホストさん',
      avatar: 'https://cdn.discordapp.com/embed/avatars/2.png',
    },
  ],
  [
    playerKey(ME),
    {
      name: '🎲ぼく',
      avatar: null,
    },
  ],
]);

export const config = (): ConfigDto => ({
  size: 5,
  freeCenter: true,
  patterns: [],
  daub: 'Manual',
  winDetection: 'Claim',
  lateJoin: 'Open',
  winLimit: 'Unlimited',
  cardsPerPlayer: 1,
});

/** A 5×5 card whose cells run 1…25 around a free centre, so a test can aim a state at a known index. */
export const card = (owner: PlayerIdDto): CardViewDto => ({
  owner,
  cardIx: 0,
  cells: Array.from({ length: 25 }, (_unused, index) => (index === 12 ? 0 : index + 1)),
  marked: [12],
  bingo: [],
  reach: [],
});

export const view = (): RoomView => ({
  config: config(),
  phase: 'Running',
  host: HOST,
  players: [HOST, ME],
  drawn: [1, 2],
  wins: [],
  cards: [card(ME)],
  revealedSeed: null,
});

const SETTINGS = {
  maxPlayers: 25,
  drawnVisibility: 'Full',
  hostAutoClose: false,
  rosterPersistence: 'KeepAcrossGames',
} as const;

export const room = (): RoomInfo => ({
  settings: {
    ...SETTINGS,
  },
  roomId: 'discord-room-1',
  gameIndex: 3,
  host: HOST,
  commitment: null,
  commitmentConfig: null,
  commitmentRoster: null,
});

/** A published commitment ties the config and the start roster to it, so the committed room is built whole rather than patched onto the uncommitted one. */
export const committedRoom = (): RoomInfo => ({
  settings: {
    ...SETTINGS,
  },
  roomId: 'discord-room-1',
  gameIndex: 7,
  host: HOST,
  commitment: `${'a'.repeat(16)}${'b'.repeat(16)}cc`,
  commitmentConfig: config(),
  commitmentRoster: [HOST, ME],
});

export const state = (): RoomState => ({
  ...initialRoomState,
  status: 'open',
  view: view(),
  room: room(),
  drawnOrder: [1, 2],
});

/** What a screen sent and what it asked the shell to show, which is the whole of what a screen does to the world outside it. */
export interface Sink {
  sent: ClientMessage[];
  ui: UiAction[];
}

export const sink = (): Sink => ({
  sent: [],
  ui: [],
});

/** A screen with nothing over it, which is where every screen starts. */
export const IDLE: UiState = {
  overlay: null,
  panel: 'board',
};

/** No DOM event reaches these handlers, and the only member any of them touches is the one that keeps a scrim from closing. */
export const EVENT = {
  stopPropagation: (): void => undefined,
};

/** A key nothing on these screens listens for, so every key handler is reached and none of them acts. */
export const KEY = {
  key: '',
  preventDefault: (): void => undefined,
  currentTarget: {
    parentElement: null,
  },
};

interface NodeProps {
  children?: ReactNode;
  onClick?: (event: typeof EVENT) => void;
  /** A native radio is chosen rather than clicked, and the arrow keys that choose it never reach a click handler at all. */
  onChange?: (event: typeof EVENT) => void;
  onKeyDown?: (event: typeof KEY) => void;
}

type Rendered = (props: NodeProps) => ReactNode;

/** None of these screens hold state, so a function element renders by being called, which is how a handler nested inside one is reached. */
const isRendered = (value: unknown): value is Rendered => typeof value === 'function';

/**
 * Walks a rendered tree and fires every click, change and key handler on it, which is the only way to reach one where there is no DOM.
 * A function element is entered through its output rather than its children, and only the element that ends up carrying the handler fires it,
 * so a control passed down as a prop is reached exactly once.
 */
export const clickEveryAction = (node: ReactNode): void => {
  Children.forEach(node, child => {
    if (!isValidElement<NodeProps>(child)) return;
    if (isRendered(child.type)) {
      clickEveryAction(child.type(child.props));
      return;
    }
    child.props.onClick?.(EVENT);
    child.props.onChange?.(EVENT);
    child.props.onKeyDown?.(KEY);
    clickEveryAction(child.props.children);
  });
};
