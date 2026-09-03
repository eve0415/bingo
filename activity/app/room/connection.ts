import type { EventDto } from '@bingo/wasm/EventDto';
import type { ClientMessage, RoomInfo, RoomView, ServerMessage } from '@bingo/wrapper/protocol';

import { parseServerMessage } from './messages';

/** Enough history to watch a game progress, bounded so a long room cannot grow the page without limit. */
const LOG_LIMIT = 50;

export interface RoomFailure {
  origin: 'room' | 'client';
  code: string;
  detail: string | null;
}

export interface RoomClosure {
  code: number;
  reason: string;
}

export interface RoomState {
  status: 'connecting' | 'open' | 'closed';
  view: RoomView | null;
  room: RoomInfo | null;
  drawnOrder: number[];
  log: EventDto[];
  failure: RoomFailure | null;
  closure: RoomClosure | null;
}

export const initialRoomState: RoomState = {
  status: 'connecting',
  view: null,
  room: null,
  drawnOrder: [],
  log: [],
  failure: null,
  closure: null,
};

/** What a socket reports back, named so the caller can adapt a browser WebSocket to it without this module depending on one. */
export interface RoomHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onClose: (code: number, reason: string) => void;
}

/** What this module needs of a socket, which is what a test can supply where no WebSocket constructor exists. */
export interface RoomTransport {
  send: (data: string) => void;
  close: () => void;
}

export type OpenTransport = (handlers: RoomHandlers) => RoomTransport;

export interface RoomConnection {
  send: (message: ClientMessage) => void;
  close: () => void;
}

/** The activity serves the room on its own origin, so the socket differs from the page only in scheme. */
export const roomSocketUrl = (origin: string, roomId: string): string => `${origin.replace(/^http/u, 'ws')}/rooms/${encodeURIComponent(roomId)}/ws`;

/**
 * The room sends a freshly projected snapshot immediately before every batch of events, so the newest snapshot is the state and the events are only a record of what moved.
 * That is why nothing here applies an event to a view, which would be a second implementation of rules the engine already owns.
 */
export const reduceRoom = (state: RoomState, message: ServerMessage): RoomState => {
  if (message.type === 'snapshot') {
    return {
      ...state,
      view: message.view,
      room: message.room,
      drawnOrder: message.drawnOrder,
      failure: null,
    };
  }
  if (message.type === 'events') {
    return {
      ...state,
      drawnOrder: message.drawnOrder,
      log: [...state.log, ...message.events].slice(-LOG_LIMIT),
      failure: state.failure?.origin === 'client' ? null : state.failure,
    };
  }
  return {
    ...state,
    failure: {
      origin: 'room',
      code: message.code,
      detail: message.detail,
    },
  };
};

/** Opens a room socket and reports every state it reaches, including the close code, which is the only evidence available when the token never reaches the wrapper. */
export const connectRoom = (open: OpenTransport, onState: (state: RoomState) => void): RoomConnection => {
  let state = initialRoomState;
  let active = true;
  const publish = (next: RoomState): void => {
    if (!active) return;
    state = next;
    onState(state);
  };
  const transport = open({
    onOpen: () => {
      publish({
        ...state,
        status: 'open',
      });
    },
    onMessage: data => {
      const message = parseServerMessage(data);
      // A silent parse rejection looks like a connected room that never loads when the wrapper and activity protocols drift.
      if (message === null) {
        publish({
          ...state,
          failure: {
            origin: 'client',
            code: 'MalformedMessage',
            detail: null,
          },
        });
        return;
      }
      publish(reduceRoom(state, message));
    },
    onClose: (code, reason) => {
      publish({
        ...state,
        status: 'closed',
        closure: {
          code,
          reason,
        },
      });
    },
  });
  return {
    send: message => {
      if (!active) return;
      // WebSocket.send throws during the handshake and cannot deliver after close, so the testable connection boundary guards every caller.
      if (state.status !== 'open') {
        publish({
          ...state,
          failure: {
            origin: 'client',
            code: 'NotConnected',
            detail: null,
          },
        });
        return;
      }
      transport.send(JSON.stringify(message));
    },
    close: () => {
      if (!active) return;
      active = false;
      transport.close();
    },
  };
};
