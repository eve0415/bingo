use crate::PlayerId;
use serde::{Deserialize, Serialize};

/// A manual mark removed because its number was undone.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RevokedMark {
    pub player: PlayerId,
    pub card_ix: u8,
    pub row: usize,
    pub col: usize,
}

/// An accepted state transition recorded in the game log.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Event {
    PlayerJoined {
        seq: u64,
        player: PlayerId,
    },
    PlayerLeft {
        seq: u64,
        player: PlayerId,
    },
    MarkPlaced {
        seq: u64,
        player: PlayerId,
        card_ix: u8,
        row: usize,
        col: usize,
    },
    MarkRemoved {
        seq: u64,
        player: PlayerId,
        card_ix: u8,
        row: usize,
        col: usize,
    },
    BingoClaimed {
        seq: u64,
        player: PlayerId,
        card_ix: u8,
    },
    GameStarted {
        seq: u64,
        actor: PlayerId,
    },
    NumberDrawn {
        seq: u64,
        actor: PlayerId,
        number: u8,
    },
    DrawUndone {
        seq: u64,
        actor: PlayerId,
        number: u8,
        revoked: Vec<RevokedMark>,
    },
    PlayerKicked {
        seq: u64,
        actor: PlayerId,
        target: PlayerId,
    },
    HostTransferred {
        seq: u64,
        actor: PlayerId,
        target: PlayerId,
    },
    GameClosed {
        seq: u64,
        actor: PlayerId,
    },
    WinRecognized {
        seq: u64,
        winners: Vec<PlayerId>,
        patterns: Vec<u128>,
        at_seq: u64,
        rank: u32,
    },
}
