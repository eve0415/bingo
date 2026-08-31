#![cfg_attr(
    test,
    allow(
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic,
        clippy::unwrap_used
    )
)]

//! Deterministic primitives for running and verifying bingo games.

pub use bingo_board::{BoardSize, Card, Drawn, MarkError, Marks};

mod card;
mod command;
mod config;
mod derive;
mod draw;
mod error;
mod event;
mod id;
mod projection;
mod reducer;
mod replay;
mod rng;
mod state;
#[cfg(test)]
mod test_support;

pub use card::generate_card;
pub use command::Command;
pub use config::{Daub, GameConfig, LateJoin, WinDetection, WinLimit};
pub use derive::commitment_input;
pub use draw::draw_order;
pub use error::{ConfigError, RuleError};
pub use event::{Event, RevokedMark};
pub use id::{PlayerId, PlayerIdError};
pub use projection::{CardView, HostView, PlayerView, project_host, project_player};
pub use reducer::apply;
pub use replay::replay;
pub use state::{GameState, Phase, RecognizedWin, init};
