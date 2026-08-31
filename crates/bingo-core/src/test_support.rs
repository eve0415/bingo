use crate::{BoardSize, Daub, GameConfig, LateJoin, PlayerId, WinDetection, WinLimit};

/// Builds a player identity from a subject, under one fixed issuer.
pub(crate) fn id(subject: &str) -> PlayerId {
    PlayerId::new("issuer", subject).unwrap()
}

/// Builds the rules tests start from: a five-wide free-centre board with
/// automatic daubing and recognition, a locked room, one card each, and a
/// single recognized winner.
pub(crate) fn base_config() -> GameConfig {
    GameConfig {
        size: BoardSize::S5,
        free_center: true,
        patterns: Vec::new(),
        daub: Daub::Auto,
        win_detection: WinDetection::Auto,
        late_join: LateJoin::Closed,
        win_limit: WinLimit::FirstOnly,
        cards_per_player: 1,
    }
}
