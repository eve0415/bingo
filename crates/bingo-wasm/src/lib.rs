#![cfg_attr(
    test,
    allow(
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic,
        clippy::unwrap_used
    )
)]

//! JSON and WebAssembly translation for the deterministic bingo engine.

pub mod wire;

use crate::wire::{
    ApplyOkDto, BridgeErrorDto, CommandDto, CommitmentOkDto, CommitmentRequestDto, Envelope,
    EventDto, HostProjectionOkDto, HostViewDto, InitOkDto, InitRequestDto, PlayerIdDto,
    PlayerProjectionOkDto, PlayerViewDto, ReplayRequestDto, Snapshot, bytes_to_hex, seed_from_hex,
};
use bingo_core::{
    GameState, apply as core_apply, commitment_input, init as core_init, replay as core_replay,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::wasm_bindgen;

const ENCODING_FAILURE: &str =
    r#"{"err":{"type":"state","message":"response could not be encoded"}}"#;

#[wasm_bindgen]
pub fn init(request: String) -> String {
    encode(match init_inner(&request) {
        Ok(payload) => Envelope::Ok(payload),
        Err(error) => Envelope::Err(error),
    })
}

fn init_inner(request: &str) -> Result<InitOkDto, BridgeErrorDto> {
    let request: InitRequestDto = decode_input("request", request)?;
    let config = request.config.into_core()?;
    let seed = seed_from_hex(&request.seed)?;
    request
        .host
        .into_core()
        .map_err(BridgeErrorDto::from)
        .and_then(|host| core_init(config, seed, host).map_err(BridgeErrorDto::from))
        .and_then(|state| snapshot_payload(&state, |state| InitOkDto { state }))
}

#[wasm_bindgen]
pub fn apply(state: String, actor: String, command: String) -> String {
    encode(match apply_inner(&state, &actor, &command) {
        Ok(payload) => Envelope::Ok(payload),
        Err(error) => Envelope::Err(error),
    })
}

fn apply_inner(state: &str, actor: &str, command: &str) -> Result<ApplyOkDto, BridgeErrorDto> {
    let mut state = decode_state(state)?;
    let actor: PlayerIdDto = decode_input("actor", actor)?;
    let command: CommandDto = decode_input("command", command)?;
    let size = state.config().size;
    actor
        .into_core()
        .map_err(BridgeErrorDto::from)
        .and_then(|actor| {
            command
                .into_core()
                .map_err(BridgeErrorDto::from)
                .map(|command| (actor, command))
        })
        .and_then(|(actor, command)| {
            core_apply(&mut state, &actor, command).map_err(BridgeErrorDto::from)
        })
        .and_then(|events| {
            let events = events
                .iter()
                .map(|event| EventDto::from_core(event, size))
                .collect();
            snapshot_payload(&state, |state| ApplyOkDto { state, events })
        })
}

#[wasm_bindgen]
pub fn replay(request: String) -> String {
    encode(match replay_inner(&request) {
        Ok(payload) => Envelope::Ok(payload),
        Err(error) => Envelope::Err(error),
    })
}

fn replay_inner(request: &str) -> Result<InitOkDto, BridgeErrorDto> {
    let request: ReplayRequestDto = decode_input("request", request)?;
    let config = request.config.into_core()?;
    let size = config.size;
    let seed = seed_from_hex(&request.seed)?;
    request
        .host
        .into_core()
        .map_err(BridgeErrorDto::from)
        .and_then(|host| {
            request
                .log
                .into_iter()
                .map(|event| event.into_core(size))
                .collect::<Result<Vec<_>, _>>()
                .map_err(BridgeErrorDto::from)
                .map(|log| (host, log))
        })
        .and_then(|(host, log)| {
            core_replay(&config, seed, &host, &log).map_err(BridgeErrorDto::from)
        })
        .and_then(|state| snapshot_payload(&state, |state| InitOkDto { state }))
}

#[wasm_bindgen]
pub fn commitment(request: String) -> String {
    encode(match commitment_inner(&request) {
        Ok(payload) => Envelope::Ok(payload),
        Err(error) => Envelope::Err(error),
    })
}

fn commitment_inner(request: &str) -> Result<CommitmentOkDto, BridgeErrorDto> {
    let request: CommitmentRequestDto = decode_input("request", request)?;
    let config = request.config.into_core()?;
    let seed = seed_from_hex(&request.seed)?;
    let mut input = commitment_input(seed, &config, &request.roster);
    input.extend_from_slice(&(request.room_id.len() as u32).to_be_bytes());
    input.extend_from_slice(request.room_id.as_bytes());
    input.extend_from_slice(&request.game_index.to_be_bytes());
    Ok(CommitmentOkDto {
        commitment: bytes_to_hex(Sha256::digest(input).into()),
    })
}

#[wasm_bindgen]
pub fn project_player(state: String, who: String) -> String {
    encode(match project_player_inner(&state, &who) {
        Ok(payload) => Envelope::Ok(payload),
        Err(error) => Envelope::Err(error),
    })
}

fn project_player_inner(state: &str, who: &str) -> Result<PlayerProjectionOkDto, BridgeErrorDto> {
    let state = decode_state(state)?;
    let who: PlayerIdDto = decode_input("who", who)?;
    who.into_core()
        .map_err(BridgeErrorDto::from)
        .map(|who| PlayerProjectionOkDto {
            view: PlayerViewDto::from(bingo_core::project_player(&state, &who)),
        })
}

#[wasm_bindgen]
pub fn project_host(state: String) -> String {
    encode(match project_host_inner(&state) {
        Ok(payload) => Envelope::Ok(payload),
        Err(error) => Envelope::Err(error),
    })
}

fn project_host_inner(state: &str) -> Result<HostProjectionOkDto, BridgeErrorDto> {
    let state = decode_state(state)?;
    Ok(HostProjectionOkDto {
        view: HostViewDto::from(bingo_core::project_host(&state)),
    })
}

fn decode_input<T: DeserializeOwned>(name: &str, value: &str) -> Result<T, BridgeErrorDto> {
    serde_json::from_str(value).map_err(|error| BridgeErrorDto::Input {
        message: format!("{name} is not valid JSON: {error}"),
    })
}

fn decode_state(value: &str) -> Result<GameState, BridgeErrorDto> {
    serde_json::from_str(value).map_err(|error| BridgeErrorDto::State {
        message: format!("snapshot is not valid: {error}"),
    })
}

fn snapshot_payload<T, U, F>(state: &T, build: F) -> Result<U, BridgeErrorDto>
where
    T: Serialize,
    F: FnOnce(Snapshot) -> U,
{
    serde_json::to_string(state)
        .map(Snapshot::new)
        .map(build)
        .map_err(|error| BridgeErrorDto::State {
            message: format!("snapshot could not be encoded: {error}"),
        })
}

fn encode<T: Serialize>(response: Envelope<T>) -> String {
    serde_json::to_string(&response).unwrap_or_else(|_| ENCODING_FAILURE.to_owned())
}

#[cfg(test)]
mod tests;
