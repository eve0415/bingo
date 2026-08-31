use crate::PlayerId;
use serde::{Deserialize, Serialize};

/// A request to advance a game state.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Command {
    Join,
    Leave,
    Mark { card_ix: u8, row: usize, col: usize },
    Unmark { card_ix: u8, row: usize, col: usize },
    Claim { card_ix: u8 },
    Start,
    Draw,
    Undo,
    Kick { target: PlayerId },
    TransferHost { target: PlayerId },
    Close,
}
