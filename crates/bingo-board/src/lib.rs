#![cfg_attr(
    test,
    allow(
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic,
        clippy::unwrap_used
    )
)]

//! Bingo board value types and analysis.

mod analysis;
mod board;
mod pattern;

pub use analysis::{Analysis, analyze};
pub use board::{BoardSize, Card, Drawn, MarkError, Marks};
pub use pattern::{blackout, default_patterns, four_corners, initial_marks};
