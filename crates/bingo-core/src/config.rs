use crate::BoardSize;
use serde::{Deserialize, Serialize};

/// Controls whether marks follow draws or are placed by players.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum Daub {
    Auto,
    Manual,
}

/// Controls whether completed patterns are recognized immediately or claimed.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum WinDetection {
    Auto,
    Claim,
}

/// Controls whether players may join after a game starts.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum LateJoin {
    Closed,
    OpenNoBacklog,
    Open,
}

/// Controls how many recognized winners finish a game.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum WinLimit {
    FirstOnly,
    Count(u8),
    Unlimited,
}

/// Values that determine a game's rules and derived artifacts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct GameConfig {
    pub size: BoardSize,
    pub free_center: bool,
    pub patterns: Vec<u128>,
    pub daub: Daub,
    pub win_detection: WinDetection,
    pub late_join: LateJoin,
    pub win_limit: WinLimit,
    pub cards_per_player: u8,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::base_config;
    use crate::{ConfigError, Phase, PlayerId, init};
    use bingo_board::default_patterns;

    #[test]
    fn init_validates_cards_and_resolves_default_patterns() {
        let host = PlayerId::new("issuer", "host").unwrap();
        let mut invalid = base_config();
        invalid.cards_per_player = 0;
        assert_eq!(
            init(invalid, [1; 32], host.clone()),
            Err(ConfigError::NoCards)
        );

        let state = init(base_config(), [1; 32], host).unwrap();
        assert_eq!(state.phase(), Phase::Lobby);
        assert_eq!(state.config().patterns, default_patterns(BoardSize::S5));
    }

    #[test]
    fn init_rejects_degenerate_pattern_masks() {
        let host = PlayerId::new("issuer", "host").unwrap();

        let mut empty = base_config();
        empty.patterns = vec![0];
        assert_eq!(
            init(empty, [1; 32], host.clone()),
            Err(ConfigError::EmptyPattern)
        );

        let mut outside = base_config();
        outside.size = BoardSize::S3;
        outside.patterns = vec![1u128 << BoardSize::S3.positions()];
        assert_eq!(
            init(outside, [1; 32], host.clone()),
            Err(ConfigError::PatternOutsideBoard)
        );

        let mut already_complete = base_config();
        already_complete.patterns = vec![1u128 << BoardSize::S5.center_index()];
        assert_eq!(
            init(already_complete, [1; 32], host.clone()),
            Err(ConfigError::PatternAlreadyComplete)
        );

        let mut center_requires_a_draw = base_config();
        center_requires_a_draw.free_center = false;
        center_requires_a_draw.patterns = vec![1u128 << BoardSize::S5.center_index()];
        assert!(init(center_requires_a_draw, [1; 32], host).is_ok());
    }
}
