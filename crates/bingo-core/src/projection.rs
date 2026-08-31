use crate::reducer::effective_marks;
use crate::state::{CardState, Participant};
use crate::{
    Drawn, GameConfig, GameState, Marks, Phase, PlayerId, RecognizedWin, commitment_input,
    draw_order, generate_card,
};
use bingo_board::analyze;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// A generated card and its current visible analysis.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct CardView {
    pub owner: PlayerId,
    pub card_ix: u8,
    pub cells: Vec<u8>,
    pub marks: Marks,
    pub bingo: Vec<u128>,
    pub reach: Vec<u128>,
}

/// State visible to one player, containing only that player's cards.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PlayerView {
    pub config: GameConfig,
    pub phase: Phase,
    pub host: PlayerId,
    pub players: Vec<PlayerId>,
    pub drawn: Drawn,
    pub wins: Vec<RecognizedWin>,
    pub cards: Vec<CardView>,
    pub seed_commitment: [u8; 32],
    pub revealed_seed: Option<[u8; 32]>,
}

/// State visible to the host, containing every participant's cards.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HostView {
    pub config: GameConfig,
    pub phase: Phase,
    pub host: PlayerId,
    pub players: Vec<PlayerId>,
    pub drawn: Drawn,
    pub wins: Vec<RecognizedWin>,
    pub cards: Vec<CardView>,
    pub seed_commitment: [u8; 32],
    pub revealed_seed: Option<[u8; 32]>,
}

/// Projects state for one player without exposing any other player's cards.
pub fn project_player(state: &GameState, who: &PlayerId) -> PlayerView {
    let order = draw_order(state.seed, state.config.size);
    let cards = state
        .participants
        .iter()
        .filter(|participant| &participant.id == who)
        .flat_map(|participant| card_views(state, participant, &order))
        .collect();
    PlayerView {
        config: state.config.clone(),
        phase: state.phase,
        host: state.host.clone(),
        players: players(state),
        drawn: state.drawn,
        wins: state.wins.clone(),
        cards,
        seed_commitment: seed_commitment(state),
        revealed_seed: revealed_seed(state),
    }
}

/// Projects state for the host with every participant's cards.
pub fn project_host(state: &GameState) -> HostView {
    let order = draw_order(state.seed, state.config.size);
    let cards = state
        .participants
        .iter()
        .flat_map(|participant| card_views(state, participant, &order))
        .collect();
    HostView {
        config: state.config.clone(),
        phase: state.phase,
        host: state.host.clone(),
        players: players(state),
        drawn: state.drawn,
        wins: state.wins.clone(),
        cards,
        seed_commitment: seed_commitment(state),
        revealed_seed: revealed_seed(state),
    }
}

fn players(state: &GameState) -> Vec<PlayerId> {
    state
        .participants
        .iter()
        .map(|participant| participant.id.clone())
        .collect()
}

fn card_views<'a>(
    state: &'a GameState,
    participant: &'a Participant,
    order: &'a [u8],
) -> impl Iterator<Item = CardView> + 'a {
    participant
        .cards
        .iter()
        .map(move |card| card_view(state, participant, card, order))
}

fn card_view(
    state: &GameState,
    participant: &Participant,
    card_state: &CardState,
    order: &[u8],
) -> CardView {
    let card = generate_card(
        state.seed,
        &participant.id,
        card_state.card_ix,
        state.config.size,
        state.config.free_center,
    );
    let marks = effective_marks(state, card_state, &card, order);
    let analysis = analyze(&state.config.patterns, &marks);
    CardView {
        owner: participant.id.clone(),
        card_ix: card_state.card_ix,
        cells: card
            .cells()
            .iter()
            .copied()
            .take(state.config.size.positions())
            .collect(),
        marks,
        bingo: analysis.bingo,
        reach: analysis.reach,
    }
}

fn seed_commitment(state: &GameState) -> [u8; 32] {
    let roster = players(state);
    Sha256::digest(commitment_input(state.seed, &state.config, &roster)).into()
}

fn revealed_seed(state: &GameState) -> Option<[u8; 32]> {
    (state.phase == Phase::Finished).then_some(state.seed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{base_config, id};
    use crate::{Command, GameConfig, WinLimit, apply, init};

    fn config() -> GameConfig {
        GameConfig {
            win_limit: WinLimit::Unlimited,
            cards_per_player: 2,
            ..base_config()
        }
    }

    fn mid_game(seed: [u8; 32]) -> crate::GameState {
        let mut state = init(config(), seed, id("host")).unwrap();
        apply(&mut state, &id("alice"), Command::Join).unwrap();
        apply(&mut state, &id("bob"), Command::Join).unwrap();
        apply(&mut state, &id("host"), Command::Start).unwrap();
        apply(&mut state, &id("host"), Command::Draw).unwrap();
        state
    }

    #[test]
    fn projections_do_not_expose_the_seed_before_finished() {
        let seed = [0xAB; 32];
        let state = mid_game(seed);
        let player = serde_json::to_value(project_player(&state, &id("alice"))).unwrap();
        let host = serde_json::to_value(project_host(&state)).unwrap();
        for value in [player, host] {
            let object = value.as_object().unwrap();
            assert!(!object.contains_key("seed"));
            assert!(object.contains_key("seed_commitment"));
            assert!(object.get("revealed_seed").unwrap().is_null());
        }
        assert_ne!(project_host(&state).seed_commitment, seed);
    }

    #[test]
    fn revealed_seed_appears_only_after_close_finishes_the_game() {
        let seed = [0xAB; 32];
        let mut state = mid_game(seed);
        assert_eq!(project_host(&state).revealed_seed, None);
        apply(&mut state, &id("host"), Command::Close).unwrap();
        assert_eq!(project_host(&state).revealed_seed, Some(seed));
        assert_eq!(
            project_player(&state, &id("alice")).revealed_seed,
            Some(seed)
        );
    }

    #[test]
    fn player_and_host_card_visibility_are_distinct() {
        let state = mid_game([1; 32]);
        let player = project_player(&state, &id("alice"));
        assert_eq!(player.cards.len(), 2);
        assert!(player.cards.iter().all(|card| card.owner == id("alice")));

        let host = project_host(&state);
        assert_eq!(host.cards.len(), 4);
        assert_eq!(host.players, vec![id("alice"), id("bob")]);
        assert!(host.cards.iter().all(|card| card.cells.len() == 25));
    }

    #[test]
    fn commitment_tracks_the_resolved_roster() {
        let mut state = init(config(), [1; 32], id("host")).unwrap();
        let empty = project_host(&state).seed_commitment;
        apply(&mut state, &id("alice"), Command::Join).unwrap();
        assert_ne!(project_host(&state).seed_commitment, empty);
        assert!(project_player(&state, &id("nobody")).cards.is_empty());
    }
}
