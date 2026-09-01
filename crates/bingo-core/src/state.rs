use crate::{ConfigError, GameConfig, PlayerId};
use bingo_board::{Drawn, Marks, blackout, default_patterns, initial_marks};
use serde::{Deserialize, Serialize};

/// Lifecycle state of one game.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Phase {
    Lobby,
    Running,
    Finished,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct CardState {
    pub(crate) card_ix: u8,
    pub(crate) marks: Marks,
    pub(crate) draw_from: usize,
    pub(crate) recognized_patterns: Vec<u128>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct Participant {
    pub(crate) id: PlayerId,
    pub(crate) cards: Vec<CardState>,
}

/// A group of players recognized at one competition rank.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RecognizedWin {
    pub winners: Vec<PlayerId>,
    pub patterns: Vec<u128>,
    pub at_seq: u64,
    pub rank: u32,
}

/// Complete serializable state for one game.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GameState {
    pub(crate) config: GameConfig,
    pub(crate) seed: [u8; 32],
    pub(crate) host: PlayerId,
    pub(crate) phase: Phase,
    pub(crate) participants: Vec<Participant>,
    pub(crate) departed_participants: Vec<Participant>,
    pub(crate) kicked_participants: Vec<PlayerId>,
    pub(crate) drawn: Drawn,
    pub(crate) draw_index: usize,
    pub(crate) draw_seqs: Vec<u64>,
    pub(crate) wins: Vec<RecognizedWin>,
    pub(crate) next_seq: u64,
}

impl GameState {
    /// Returns the resolved rules used by this game.
    pub const fn config(&self) -> &GameConfig {
        &self.config
    }

    /// Returns the current lifecycle phase.
    pub const fn phase(&self) -> Phase {
        self.phase
    }

    /// Returns the current host identity.
    pub const fn host(&self) -> &PlayerId {
        &self.host
    }

    /// Returns the numbers drawn so far.
    pub const fn drawn(&self) -> Drawn {
        self.drawn
    }

    /// Returns the recognized competition ranks.
    pub fn wins(&self) -> &[RecognizedWin] {
        &self.wins
    }
}

/// Creates a validated game in its lobby phase.
pub fn init(
    mut config: GameConfig,
    seed: [u8; 32],
    host: PlayerId,
) -> Result<GameState, ConfigError> {
    if config.cards_per_player == 0 {
        return Err(ConfigError::NoCards);
    }
    if config.patterns.is_empty() {
        config.patterns = default_patterns(config.size);
    }
    let valid_positions = blackout(config.size);
    let initial_bits = initial_marks(config.size, config.free_center).bits();
    for pattern in &config.patterns {
        if *pattern == 0 {
            return Err(ConfigError::EmptyPattern);
        }
        if pattern & !valid_positions != 0 {
            return Err(ConfigError::PatternOutsideBoard);
        }
        if pattern & initial_bits == *pattern {
            return Err(ConfigError::PatternAlreadyComplete);
        }
    }
    Ok(GameState {
        config,
        seed,
        host,
        phase: Phase::Lobby,
        participants: Vec::new(),
        departed_participants: Vec::new(),
        kicked_participants: Vec::new(),
        drawn: Drawn::default(),
        draw_index: 0,
        draw_seqs: Vec::new(),
        wins: Vec::new(),
        next_seq: 0,
    })
}
