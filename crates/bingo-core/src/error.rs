use serde::{Deserialize, Serialize};

/// Error returned when game configuration cannot produce a playable game.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum ConfigError {
    NoCards,
    EmptyPattern,
    PatternOutsideBoard,
    PatternAlreadyComplete,
}

/// Error returned when a command violates the game rules.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum RuleError {
    NotHost,
    WrongPhase,
    NotAParticipant,
    RoomLocked,
    UnknownCard,
    NumberNotDrawn,
    BacklogMarkNotAllowed,
    NumberNotOnCard,
    NoSuchPosition,
    NothingToUndo,
    WinAlreadyRecognised,
    NoBingo,
    ManualDaubDisabled,
    ClaimDisabled,
    NoNumbersRemain,
    NoSequenceRemain,
    LogMismatch,
    Kicked,
    AlreadyJoined,
}

impl RuleError {
    /// Returns every rule error variant for exhaustive consumer checks.
    pub const fn all() -> &'static [Self] {
        &[
            Self::NotHost,
            Self::WrongPhase,
            Self::NotAParticipant,
            Self::RoomLocked,
            Self::UnknownCard,
            Self::NumberNotDrawn,
            Self::BacklogMarkNotAllowed,
            Self::NumberNotOnCard,
            Self::NoSuchPosition,
            Self::NothingToUndo,
            Self::WinAlreadyRecognised,
            Self::NoBingo,
            Self::ManualDaubDisabled,
            Self::ClaimDisabled,
            Self::NoNumbersRemain,
            Self::NoSequenceRemain,
            Self::LogMismatch,
            Self::Kicked,
            Self::AlreadyJoined,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The number of positions `all()` must fill.
    const VARIANT_COUNT: usize = 19;

    /// Maps a variant to the position `all()` lists it at.
    ///
    /// The match has no wildcard arm, so a new variant of `RuleError` does not
    /// compile until it is given a position here, and `all()` must then be
    /// extended to carry it at that position.
    fn position_in_all(error: &RuleError) -> usize {
        match error {
            RuleError::NotHost => 0,
            RuleError::WrongPhase => 1,
            RuleError::NotAParticipant => 2,
            RuleError::RoomLocked => 3,
            RuleError::UnknownCard => 4,
            RuleError::NumberNotDrawn => 5,
            RuleError::BacklogMarkNotAllowed => 6,
            RuleError::NumberNotOnCard => 7,
            RuleError::NoSuchPosition => 8,
            RuleError::NothingToUndo => 9,
            RuleError::WinAlreadyRecognised => 10,
            RuleError::NoBingo => 11,
            RuleError::ManualDaubDisabled => 12,
            RuleError::ClaimDisabled => 13,
            RuleError::NoNumbersRemain => 14,
            RuleError::NoSequenceRemain => 15,
            RuleError::LogMismatch => 16,
            RuleError::Kicked => 17,
            RuleError::AlreadyJoined => 18,
        }
    }

    #[test]
    fn all_lists_every_variant_exactly_once() {
        let listed = RuleError::all();
        assert_eq!(listed.len(), VARIANT_COUNT);
        let mut positions: Vec<usize> = listed.iter().map(position_in_all).collect();
        positions.sort_unstable();
        positions.dedup();
        assert_eq!(positions, (0..VARIANT_COUNT).collect::<Vec<usize>>());
        for (position, error) in listed.iter().enumerate() {
            assert_eq!(
                position_in_all(error),
                position,
                "{error:?} is out of place"
            );
        }
    }

    #[test]
    fn every_rule_error_renders_and_compares() {
        for error in RuleError::all() {
            assert!(!format!("{error:?}").is_empty());
            let cloned = error.clone();
            assert_eq!(error, &cloned);
        }
    }
}
