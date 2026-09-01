import type { ApplyOkDto } from '@bingo/wasm/ApplyOkDto';
import type { BridgeErrorDto } from '@bingo/wasm/BridgeErrorDto';
import type { CommandDto } from '@bingo/wasm/CommandDto';
import type { CommitmentOkDto } from '@bingo/wasm/CommitmentOkDto';
import type { CommitmentRequestDto } from '@bingo/wasm/CommitmentRequestDto';
import type { Envelope } from '@bingo/wasm/Envelope';
import type { EventDto } from '@bingo/wasm/EventDto';
import type { HostProjectionOkDto } from '@bingo/wasm/HostProjectionOkDto';
import type { HostViewDto } from '@bingo/wasm/HostViewDto';
import type { InitOkDto } from '@bingo/wasm/InitOkDto';
import type { InitRequestDto } from '@bingo/wasm/InitRequestDto';
import type { PlayerIdDto } from '@bingo/wasm/PlayerIdDto';
import type { PlayerProjectionOkDto } from '@bingo/wasm/PlayerProjectionOkDto';
import type { PlayerViewDto } from '@bingo/wasm/PlayerViewDto';
import type { ReplayRequestDto } from '@bingo/wasm/ReplayRequestDto';
import type { Snapshot } from '@bingo/wasm/Snapshot';

import wasmModule from '@bingo/wasm/bingo_wasm_bg.wasm';
import { apply, commitment, init, initSync, project_host, project_player, replay } from '@bingo/wasm/glue';

initSync({
  module: wasmModule,
});
export type EngineResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: BridgeErrorDto;
    };
const decode = <T>(value: string): EngineResult<T> => {
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- wasm-bindgen returns the generated Envelope<T> JSON contract.
  const envelope: Envelope<T> = JSON.parse(value);
  return 'ok' in envelope
    ? {
        ok: true,
        value: envelope.ok,
      }
    : {
        ok: false,
        error: envelope.err,
      };
};
export const initialize = (request: InitRequestDto): EngineResult<InitOkDto> => decode(init(JSON.stringify(request)));
export const applyCommand = (state: Snapshot, actor: PlayerIdDto, command: CommandDto): EngineResult<ApplyOkDto> =>
  decode(apply(state, JSON.stringify(actor), JSON.stringify(command)));
export const rebuild = (request: ReplayRequestDto): EngineResult<InitOkDto> => decode(replay(JSON.stringify(request)));
export const createCommitment = (request: CommitmentRequestDto): EngineResult<CommitmentOkDto> => decode(commitment(JSON.stringify(request)));
export const projectPlayer = (state: Snapshot, who: PlayerIdDto): EngineResult<PlayerViewDto> => {
  const result = decode<PlayerProjectionOkDto>(project_player(state, JSON.stringify(who)));
  return result.ok
    ? {
        ok: true,
        value: result.value.view,
      }
    : result;
};
export const projectHost = (state: Snapshot): EngineResult<HostViewDto> => {
  const result = decode<HostProjectionOkDto>(project_host(state));
  return result.ok
    ? {
        ok: true,
        value: result.value.view,
      }
    : result;
};
export const eventSequence = (event: EventDto): number => {
  if ('PlayerJoined' in event) return event.PlayerJoined.seq;
  if ('PlayerLeft' in event) return event.PlayerLeft.seq;
  if ('MarkPlaced' in event) return event.MarkPlaced.seq;
  if ('MarkRemoved' in event) return event.MarkRemoved.seq;
  if ('BingoClaimed' in event) return event.BingoClaimed.seq;
  if ('GameStarted' in event) return event.GameStarted.seq;
  if ('NumberDrawn' in event) return event.NumberDrawn.seq;
  if ('DrawUndone' in event) return event.DrawUndone.seq;
  if ('PlayerKicked' in event) return event.PlayerKicked.seq;
  if ('HostTransferred' in event) return event.HostTransferred.seq;
  if ('GameClosed' in event) return event.GameClosed.seq;
  return event.WinRecognized.seq;
};
export const eventKind = (event: EventDto): string => {
  if ('PlayerJoined' in event) return 'PlayerJoined';
  if ('PlayerLeft' in event) return 'PlayerLeft';
  if ('MarkPlaced' in event) return 'MarkPlaced';
  if ('MarkRemoved' in event) return 'MarkRemoved';
  if ('BingoClaimed' in event) return 'BingoClaimed';
  if ('GameStarted' in event) return 'GameStarted';
  if ('NumberDrawn' in event) return 'NumberDrawn';
  if ('DrawUndone' in event) return 'DrawUndone';
  if ('PlayerKicked' in event) return 'PlayerKicked';
  if ('HostTransferred' in event) return 'HostTransferred';
  if ('GameClosed' in event) return 'GameClosed';
  return 'WinRecognized';
};
