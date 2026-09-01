use crate::state::{CardState, Participant};
use crate::{
    Card, Command, Daub, Event, GameState, LateJoin, Phase, PlayerId, RecognizedWin, RuleError,
    WinDetection, WinLimit, draw_order, generate_card,
};
use bingo_board::{Marks, analyze, initial_marks};
use std::collections::BTreeSet;

/// Applies one command atomically and returns the events it accepted.
pub fn apply(
    state: &mut GameState,
    actor: &PlayerId,
    command: Command,
) -> Result<Vec<Event>, RuleError> {
    if is_host_command(&command) && actor != &state.host {
        return Err(RuleError::NotHost);
    }

    match command {
        Command::Join => join(state, actor),
        Command::Draw => draw(state, actor),
        Command::Undo => undo(state, actor),
        Command::Mark { card_ix, row, col } => {
            change_mark(state, actor, card_ix, row, col, MarkChange::Place)
        }
        Command::Unmark { card_ix, row, col } => {
            change_mark(state, actor, card_ix, row, col, MarkChange::Remove)
        }
        Command::Claim { card_ix } => claim(state, actor, card_ix),
        Command::Start => start(state, actor),
        Command::Close => close(state, actor),
        Command::Leave => leave(state, actor),
        Command::Kick { target } => kick(state, actor, &target),
        Command::TransferHost { target } => transfer_host(state, actor, target),
    }
}

fn is_host_command(command: &Command) -> bool {
    matches!(
        command,
        Command::Start
            | Command::Draw
            | Command::Undo
            | Command::Kick { .. }
            | Command::TransferHost { .. }
            | Command::Close
    )
}

fn require_active(state: &GameState) -> Result<(), RuleError> {
    if state.phase == Phase::Finished {
        return Err(RuleError::WrongPhase);
    }
    Ok(())
}

fn allocate_seq(state: &mut GameState) -> Result<u64, RuleError> {
    reserve_sequences(state, 1)
}

fn reserve_sequences(state: &mut GameState, count: u64) -> Result<u64, RuleError> {
    let seq = state.next_seq;
    let Some(next) = seq.checked_add(count) else {
        return Err(RuleError::NoSequenceRemain);
    };
    state.next_seq = next;
    Ok(seq)
}

fn join(state: &mut GameState, actor: &PlayerId) -> Result<Vec<Event>, RuleError> {
    if state.phase == Phase::Finished {
        return Err(RuleError::WrongPhase);
    }
    if state.kicked_participants.iter().any(|player| player == actor) {
        return Err(RuleError::Kicked);
    }
    if participant_index(state, actor).is_some() {
        return Err(RuleError::AlreadyJoined);
    }

    let departed = state
        .departed_participants
        .iter()
        .enumerate()
        .find(|(_, participant)| &participant.id == actor)
        .map(|(index, participant)| (index, participant.clone()));
    let participant = if let Some((_, participant)) = &departed {
        participant.clone()
    } else {
        let draw_from = if state.phase == Phase::Lobby {
            0
        } else {
            match state.config.late_join {
                LateJoin::Closed => return Err(RuleError::RoomLocked),
                LateJoin::OpenNoBacklog => state.draw_index,
                LateJoin::Open => 0,
            }
        };
        let mut cards = Vec::with_capacity(usize::from(state.config.cards_per_player));
        for card_ix in 0..state.config.cards_per_player {
            cards.push(CardState {
                card_ix,
                marks: initial_marks(state.config.size, state.config.free_center),
                draw_from,
                recognized_patterns: Vec::new(),
            });
        }
        Participant {
            id: actor.clone(),
            cards,
        }
    };
    let recognition = if state.phase == Phase::Running
        && state.config.win_detection == WinDetection::Auto
        && (departed.is_some() || state.config.late_join == LateJoin::Open)
    {
        let order = draw_order(state.seed, state.config.size);
        completed_recognition_at(state, &participant, &order, state.draw_index)
    } else {
        PlayerRecognition {
            player: actor.clone(),
            cards: Vec::new(),
        }
    };
    let event_count = if recognition.cards.is_empty() { 1 } else { 2 };
    let seq = reserve_sequences(state, event_count)?;

    if let Some((index, _)) = departed {
        state.departed_participants.remove(index);
    }
    state.participants.push(participant);
    let mut events = vec![Event::PlayerJoined {
        seq,
        player: actor.clone(),
    }];
    if !recognition.cards.is_empty() {
        recognize_players(state, vec![recognition], seq, seq + 1, &mut events);
    }
    Ok(events)
}

/// Yields the draws a card may take a mark from: those at or after the draw the
/// card joined at, and before the draw pointer being evaluated.
///
/// A number counts for a card only if it appears here, which is the single rule
/// the automatic marks and the manual backlog guard both answer to.
fn markable_draws(order: &[u8], draw_from: usize, draw_index: usize) -> impl Iterator<Item = u8> {
    order.iter().copied().take(draw_index).skip(draw_from)
}

/// Returns the marks a card carries right now, given the card and draw order
/// the caller already holds.
pub(crate) fn effective_marks(
    state: &GameState,
    card_state: &CardState,
    card: &Card,
    order: &[u8],
) -> Marks {
    if state.config.daub == Daub::Manual {
        return card_state.marks;
    }
    automatic_marks(state, card_state, card, order, state.draw_index)
}

fn effective_marks_at(
    state: &GameState,
    participant: &Participant,
    card_state: &CardState,
    order: &[u8],
    draw_index: usize,
) -> Marks {
    if state.config.daub == Daub::Manual {
        return card_state.marks;
    }

    let card = generate_card(
        state.seed,
        &participant.id,
        card_state.card_ix,
        state.config.size,
        state.config.free_center,
    );
    automatic_marks(state, card_state, &card, order, draw_index)
}

fn automatic_marks(
    state: &GameState,
    card_state: &CardState,
    card: &Card,
    order: &[u8],
    draw_index: usize,
) -> Marks {
    let mut marks = initial_marks(state.config.size, state.config.free_center);
    for number in markable_draws(order, card_state.draw_from, draw_index) {
        if let Some((row, col)) = card.position_of(number) {
            let _ = marks.set(row, col);
        }
    }
    marks
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CardRecognition {
    card_ix: u8,
    patterns: Vec<u128>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PlayerRecognition {
    player: PlayerId,
    cards: Vec<CardRecognition>,
}

fn bingo_patterns(patterns: &[u128], marks: &Marks) -> Vec<u128> {
    let mut completed = analyze(patterns, marks).bingo;
    completed.sort_unstable();
    completed.dedup();
    completed
}

impl CardRecognition {
    /// Recognizes what a card has completed but not yet been credited for.
    ///
    /// Every recognition is built here, against the card's own record, so no
    /// path can credit the same pattern on the same card twice.
    fn completed(card: &CardState, patterns: &[u128], marks: &Marks) -> Option<Self> {
        Self::from_completed(card, bingo_patterns(patterns, marks))
    }

    /// Recognizes an already-computed set of completed patterns.
    fn from_completed(card: &CardState, mut completed: Vec<u128>) -> Option<Self> {
        completed.retain(|pattern| !card.recognized_patterns.contains(pattern));
        (!completed.is_empty()).then_some(Self {
            card_ix: card.card_ix,
            patterns: completed,
        })
    }
}

fn completed_recognition_at(
    state: &GameState,
    participant: &Participant,
    order: &[u8],
    draw_index: usize,
) -> PlayerRecognition {
    let mut cards = Vec::new();
    for card in &participant.cards {
        let marks = effective_marks_at(state, participant, card, order, draw_index);
        if let Some(recognition) = CardRecognition::completed(card, &state.config.patterns, &marks)
        {
            cards.push(recognition);
        }
    }
    PlayerRecognition {
        player: participant.id.clone(),
        cards,
    }
}

fn automatic_winners(state: &GameState, order: &[u8], draw_index: usize) -> Vec<PlayerRecognition> {
    state
        .participants
        .iter()
        .map(|participant| completed_recognition_at(state, participant, order, draw_index))
        .filter(|recognition| !recognition.cards.is_empty())
        .collect()
}

fn recognize_players(
    state: &mut GameState,
    recognitions: Vec<PlayerRecognition>,
    at_seq: u64,
    event_seq: u64,
    events: &mut Vec<Event>,
) {
    for recognition in &recognitions {
        for participant in state
            .participants
            .iter_mut()
            .filter(|participant| participant.id == recognition.player)
        {
            for card_recognition in &recognition.cards {
                for card in participant
                    .cards
                    .iter_mut()
                    .filter(|card| card.card_ix == card_recognition.card_ix)
                {
                    card.recognized_patterns
                        .extend_from_slice(&card_recognition.patterns);
                }
            }
        }
    }
    let winners: Vec<PlayerId> = recognitions
        .iter()
        .map(|recognition| recognition.player.clone())
        .collect();
    let mut patterns: Vec<u128> = recognitions
        .iter()
        .flat_map(|recognition| &recognition.cards)
        .flat_map(|card| card.patterns.iter().copied())
        .collect();
    patterns.sort_unstable();
    patterns.dedup();
    let previous_winners: usize = state.wins.iter().map(|win| win.winners.len()).sum();
    let rank = u32::try_from(previous_winners)
        .unwrap_or(u32::MAX)
        .saturating_add(1);
    let recognized = RecognizedWin {
        winners: winners.clone(),
        patterns: patterns.clone(),
        at_seq,
        rank,
    };
    state.wins.push(recognized);
    events.push(Event::WinRecognized {
        seq: event_seq,
        winners,
        patterns,
        at_seq,
        rank,
    });

    let winner_count = state
        .wins
        .iter()
        .flat_map(|win| &win.winners)
        .collect::<BTreeSet<_>>()
        .len();
    let finished = match state.config.win_limit {
        WinLimit::FirstOnly => winner_count >= 1,
        WinLimit::Count(limit) => winner_count >= usize::from(limit),
        WinLimit::Unlimited => false,
    };
    if finished {
        state.phase = Phase::Finished;
    }
}

fn participant_index(state: &GameState, player: &PlayerId) -> Option<usize> {
    state
        .participants
        .iter()
        .position(|participant| &participant.id == player)
}

fn start(state: &mut GameState, actor: &PlayerId) -> Result<Vec<Event>, RuleError> {
    if state.phase != Phase::Lobby || state.participants.is_empty() {
        return Err(RuleError::WrongPhase);
    }
    let seq = allocate_seq(state)?;
    state.phase = Phase::Running;
    Ok(vec![Event::GameStarted {
        seq,
        actor: actor.clone(),
    }])
}

fn draw(state: &mut GameState, actor: &PlayerId) -> Result<Vec<Event>, RuleError> {
    if state.phase != Phase::Running {
        return Err(RuleError::WrongPhase);
    }
    let order = draw_order(state.seed, state.config.size);
    let Some(number) = order.get(state.draw_index).copied() else {
        return Err(RuleError::NoNumbersRemain);
    };
    let recognitions = if state.config.win_detection == WinDetection::Auto {
        automatic_winners(state, &order, state.draw_index.saturating_add(1))
    } else {
        Vec::new()
    };
    let event_count = if recognitions.is_empty() { 1 } else { 2 };
    let seq = reserve_sequences(state, event_count)?;
    state.drawn.insert(number);
    state.draw_index += 1;
    state.draw_seqs.push(seq);
    let mut events = vec![Event::NumberDrawn {
        seq,
        actor: actor.clone(),
        number,
    }];
    if !recognitions.is_empty() {
        recognize_players(state, recognitions, seq, seq + 1, &mut events);
    }
    Ok(events)
}

fn undo(state: &mut GameState, actor: &PlayerId) -> Result<Vec<Event>, RuleError> {
    if state.phase != Phase::Running {
        return Err(RuleError::WrongPhase);
    }
    let Some(previous_index) = state.draw_index.checked_sub(1) else {
        return Err(RuleError::NothingToUndo);
    };
    let Some(draw_seq) = state.draw_seqs.last().copied() else {
        return Err(RuleError::NothingToUndo);
    };
    if state.wins.iter().any(|win| win.at_seq >= draw_seq) {
        return Err(RuleError::WinAlreadyRecognised);
    }
    let order = draw_order(state.seed, state.config.size);
    let Some(number) = order.get(previous_index).copied() else {
        return Err(RuleError::NothingToUndo);
    };
    let seq = allocate_seq(state)?;
    let seed = state.seed;
    let size = state.config.size;
    let free_center = state.config.free_center;
    let manual = state.config.daub == Daub::Manual;
    let mut revoked = Vec::new();
    for participant in state
        .participants
        .iter_mut()
        .chain(state.departed_participants.iter_mut())
    {
        for card_state in &mut participant.cards {
            card_state.draw_from = card_state.draw_from.min(previous_index);
            if !manual {
                continue;
            }
            let card = generate_card(seed, &participant.id, card_state.card_ix, size, free_center);
            if let Some((row, col)) = card.position_of(number)
                && card_state.marks.get(row, col)
            {
                let _ = card_state.marks.clear(row, col);
                revoked.push(crate::RevokedMark {
                    player: participant.id.clone(),
                    card_ix: card_state.card_ix,
                    row,
                    col,
                });
            }
        }
    }
    state.drawn.clear(number);
    state.draw_index = previous_index;
    let _ = state.draw_seqs.pop();
    Ok(vec![Event::DrawUndone {
        seq,
        actor: actor.clone(),
        number,
        revoked,
    }])
}

#[derive(Clone, Copy)]
enum MarkChange {
    Place,
    Remove,
}

fn change_mark(
    state: &mut GameState,
    actor: &PlayerId,
    card_ix: u8,
    row: usize,
    col: usize,
    change: MarkChange,
) -> Result<Vec<Event>, RuleError> {
    if state.config.daub != Daub::Manual {
        return Err(RuleError::ManualDaubDisabled);
    }
    if state.phase != Phase::Running {
        return Err(RuleError::WrongPhase);
    }

    let size = state.config.size;
    let side = usize::from(size.as_u8());
    let seed = state.seed;
    let free_center = state.config.free_center;
    let drawn = state.drawn;
    let draw_index = state.draw_index;
    let should_recognize =
        matches!(change, MarkChange::Place) && state.config.win_detection == WinDetection::Auto;
    let configured_patterns = state.config.patterns.clone();
    let Some(participant) = state
        .participants
        .iter_mut()
        .find(|participant| &participant.id == actor)
    else {
        return Err(RuleError::UnknownCard);
    };
    let Some(card_state) = participant
        .cards
        .iter_mut()
        .find(|card| card.card_ix == card_ix)
    else {
        return Err(RuleError::UnknownCard);
    };
    if row >= side || col >= side {
        return Err(RuleError::NoSuchPosition);
    }
    let card = generate_card(seed, actor, card_ix, size, free_center);
    let number = card.cell(row, col);
    if number == 0 {
        return Err(RuleError::NumberNotOnCard);
    }
    if !drawn.contains(number) {
        return Err(RuleError::NumberNotDrawn);
    }
    // The number is already known drawn, so it sits somewhere in the order
    // before the draw pointer, and a card's join boundary never runs past that
    // pointer. Falling outside the window is therefore exactly the same thing
    // as sitting in the backlog the card arrived too late for.
    if matches!(change, MarkChange::Place) {
        let order = draw_order(seed, size);
        if !markable_draws(&order, card_state.draw_from, draw_index)
            .any(|drawn_number| drawn_number == number)
        {
            return Err(RuleError::BacklogMarkNotAllowed);
        }
    }

    let mut prospective_marks = card_state.marks;
    match change {
        MarkChange::Place => {
            let _ = prospective_marks.set(row, col);
        }
        MarkChange::Remove => {
            let _ = prospective_marks.clear(row, col);
        }
    }
    let recognition = if should_recognize {
        CardRecognition::completed(card_state, &configured_patterns, &prospective_marks)
    } else {
        None
    };
    let event_count = if recognition.is_none() { 1 } else { 2 };
    let seq = state.next_seq;
    let Some(next_seq) = seq.checked_add(event_count) else {
        return Err(RuleError::NoSequenceRemain);
    };

    card_state.marks = prospective_marks;
    state.next_seq = next_seq;
    let event = match change {
        MarkChange::Place => Event::MarkPlaced {
            seq,
            player: actor.clone(),
            card_ix,
            row,
            col,
        },
        MarkChange::Remove => Event::MarkRemoved {
            seq,
            player: actor.clone(),
            card_ix,
            row,
            col,
        },
    };
    let mut events = vec![event];
    if let Some(recognition) = recognition {
        recognize_players(
            state,
            vec![PlayerRecognition {
                player: actor.clone(),
                cards: vec![recognition],
            }],
            seq,
            seq + 1,
            &mut events,
        );
    }
    Ok(events)
}

fn claim(state: &mut GameState, actor: &PlayerId, card_ix: u8) -> Result<Vec<Event>, RuleError> {
    if state.config.win_detection != WinDetection::Claim {
        return Err(RuleError::ClaimDisabled);
    }
    if state.phase != Phase::Running {
        return Err(RuleError::WrongPhase);
    }
    let Some(participant) = state
        .participants
        .iter()
        .find(|participant| &participant.id == actor)
    else {
        return Err(RuleError::UnknownCard);
    };
    let Some(card_state) = participant
        .cards
        .iter()
        .find(|card| card.card_ix == card_ix)
    else {
        return Err(RuleError::UnknownCard);
    };
    let order = draw_order(state.seed, state.config.size);
    let card = generate_card(
        state.seed,
        &participant.id,
        card_state.card_ix,
        state.config.size,
        state.config.free_center,
    );
    let completed = bingo_patterns(
        &state.config.patterns,
        &effective_marks(state, card_state, &card, &order),
    );
    if completed.is_empty() {
        return Err(RuleError::NoBingo);
    }
    let Some(recognition) = CardRecognition::from_completed(card_state, completed) else {
        return Err(RuleError::WinAlreadyRecognised);
    };
    let seq = reserve_sequences(state, 2)?;
    let mut events = vec![Event::BingoClaimed {
        seq,
        player: actor.clone(),
        card_ix,
    }];
    recognize_players(
        state,
        vec![PlayerRecognition {
            player: actor.clone(),
            cards: vec![recognition],
        }],
        seq,
        seq + 1,
        &mut events,
    );
    Ok(events)
}

fn close(state: &mut GameState, actor: &PlayerId) -> Result<Vec<Event>, RuleError> {
    require_active(state)?;
    let seq = allocate_seq(state)?;
    state.phase = Phase::Finished;
    Ok(vec![Event::GameClosed {
        seq,
        actor: actor.clone(),
    }])
}

fn leave(state: &mut GameState, actor: &PlayerId) -> Result<Vec<Event>, RuleError> {
    require_active(state)?;
    let Some(index) = participant_index(state, actor) else {
        return Err(RuleError::NotAParticipant);
    };
    let seq = allocate_seq(state)?;
    let participant = state.participants.remove(index);
    state.departed_participants.push(participant);
    Ok(vec![Event::PlayerLeft {
        seq,
        player: actor.clone(),
    }])
}

/// The roster a kick target was found on, and its position there.
enum KickSource {
    Active(usize),
    Departed(usize),
}

fn kick_source(state: &GameState, target: &PlayerId) -> Option<KickSource> {
    if let Some(index) = participant_index(state, target) {
        return Some(KickSource::Active(index));
    }
    state
        .departed_participants
        .iter()
        .position(|participant| &participant.id == target)
        .map(KickSource::Departed)
}

fn kick(
    state: &mut GameState,
    actor: &PlayerId,
    target: &PlayerId,
) -> Result<Vec<Event>, RuleError> {
    require_active(state)?;
    // A player who has already left is still kickable: otherwise leaving first
    // would dodge the ban for the rest of the game.
    let Some(roster) = kick_source(state, target) else {
        return Err(RuleError::NotAParticipant);
    };
    let seq = allocate_seq(state)?;
    match roster {
        KickSource::Active(index) => state.participants.remove(index),
        KickSource::Departed(index) => state.departed_participants.remove(index),
    };
    state.kicked_participants.push(target.clone());
    Ok(vec![Event::PlayerKicked {
        seq,
        actor: actor.clone(),
        target: target.clone(),
    }])
}

fn transfer_host(
    state: &mut GameState,
    actor: &PlayerId,
    target: PlayerId,
) -> Result<Vec<Event>, RuleError> {
    require_active(state)?;
    if participant_index(state, &target).is_none() {
        return Err(RuleError::NotAParticipant);
    }
    let seq = allocate_seq(state)?;
    state.host = target.clone();
    Ok(vec![Event::HostTransferred {
        seq,
        actor: actor.clone(),
        target,
    }])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Participant;
    use crate::test_support::{base_config, id};
    use crate::{
        BoardSize, Daub, Event, LateJoin, Phase, PlayerId, RuleError, WinDetection, WinLimit, init,
    };

    fn marks_of(
        state: &crate::GameState,
        participant: &Participant,
        card_state: &CardState,
    ) -> Marks {
        effective_marks_at(
            state,
            participant,
            card_state,
            &crate::draw_order(state.seed, state.config.size),
            state.draw_index,
        )
    }

    fn recognition(player: PlayerId, patterns: Vec<u128>) -> PlayerRecognition {
        PlayerRecognition {
            player,
            cards: vec![CardRecognition {
                card_ix: 0,
                patterns,
            }],
        }
    }

    fn lobby() -> crate::GameState {
        init(base_config(), [1; 32], id("host")).unwrap()
    }

    #[test]
    fn host_authority_is_checked_before_other_host_command_guards() {
        let mut state = lobby();
        let alice = id("alice");
        for command in [
            crate::Command::Start,
            crate::Command::Draw,
            crate::Command::Undo,
            crate::Command::Kick {
                target: alice.clone(),
            },
            crate::Command::TransferHost {
                target: alice.clone(),
            },
            crate::Command::Close,
        ] {
            assert_eq!(apply(&mut state, &alice, command), Err(RuleError::NotHost));
        }
        assert_eq!(state, lobby());
    }

    #[test]
    fn start_and_close_enforce_lifecycle_guards_and_emit_events() {
        let mut state = lobby();
        let host = id("host");
        assert_eq!(
            apply(&mut state, &host, crate::Command::Start),
            Err(RuleError::WrongPhase)
        );
        state.participants.push(Participant {
            id: id("alice"),
            cards: Vec::new(),
        });
        assert_eq!(
            apply(&mut state, &host, crate::Command::Draw),
            Err(RuleError::WrongPhase)
        );

        assert_eq!(
            apply(&mut state, &host, crate::Command::Start),
            Ok(vec![Event::GameStarted {
                seq: 0,
                actor: host.clone(),
            }])
        );
        assert_eq!(state.phase(), Phase::Running);
        assert_eq!(
            apply(&mut state, &host, crate::Command::Start),
            Err(RuleError::WrongPhase)
        );
        assert_eq!(
            apply(&mut state, &host, crate::Command::Close),
            Ok(vec![Event::GameClosed {
                seq: 1,
                actor: host.clone(),
            }])
        );
        assert_eq!(state.phase(), Phase::Finished);
        assert_eq!(
            apply(&mut state, &host, crate::Command::Close),
            Err(RuleError::WrongPhase)
        );
    }

    #[test]
    fn leave_kick_and_host_transfer_enforce_participant_guards() {
        let mut state = lobby();
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        state.participants.extend([
            Participant {
                id: alice.clone(),
                cards: Vec::new(),
            },
            Participant {
                id: bob.clone(),
                cards: Vec::new(),
            },
        ]);

        assert_eq!(
            apply(&mut state, &id("nobody"), crate::Command::Leave),
            Err(RuleError::NotAParticipant)
        );
        assert_eq!(
            apply(&mut state, &alice, crate::Command::Leave),
            Ok(vec![Event::PlayerLeft {
                seq: 0,
                player: alice.clone(),
            }])
        );
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::Kick {
                    target: id("nobody"),
                },
            ),
            Err(RuleError::NotAParticipant)
        );
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::Kick {
                    target: alice.clone(),
                },
            ),
            Ok(vec![Event::PlayerKicked {
                seq: 1,
                actor: host.clone(),
                target: alice.clone(),
            }])
        );
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::TransferHost {
                    target: alice,
                },
            ),
            Err(RuleError::NotAParticipant)
        );
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::TransferHost {
                    target: bob.clone(),
                },
            ),
            Ok(vec![Event::HostTransferred {
                seq: 2,
                actor: host.clone(),
                target: bob.clone(),
            }])
        );
        assert_eq!(state.host(), &bob);
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::Kick {
                    target: bob.clone(),
                },
            ),
            Err(RuleError::NotHost)
        );
        assert_eq!(
            apply(
                &mut state,
                &bob,
                crate::Command::Kick {
                    target: bob.clone(),
                },
            ),
            Ok(vec![Event::PlayerKicked {
                seq: 3,
                actor: bob.clone(),
                target: bob,
            }])
        );
    }

    #[test]
    fn a_finished_game_rejects_participant_lifecycle_commands() {
        let mut state = lobby();
        let host = id("host");
        let alice = id("alice");
        state.participants.push(Participant {
            id: alice.clone(),
            cards: Vec::new(),
        });
        apply(&mut state, &host, crate::Command::Close).unwrap();
        assert_eq!(
            apply(&mut state, &alice, crate::Command::Leave),
            Err(RuleError::WrongPhase)
        );
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::TransferHost { target: alice },
            ),
            Err(RuleError::WrongPhase)
        );
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::Kick { target: id("host") },
            ),
            Err(RuleError::WrongPhase)
        );
    }

    #[test]
    fn sequence_exhaustion_is_an_error_before_mutation() {
        let mut state = lobby();
        state.participants.push(Participant {
            id: id("alice"),
            cards: Vec::new(),
        });
        state.next_seq = u64::MAX;
        let before = state.clone();
        assert_eq!(
            apply(&mut state, &id("host"), crate::Command::Start),
            Err(RuleError::NoSequenceRemain)
        );
        assert_eq!(state, before);
    }

    fn assert_sequence_exhausted(
        mut state: crate::GameState,
        actor: PlayerId,
        command: crate::Command,
    ) {
        state.next_seq = u64::MAX;
        let before = state.clone();
        assert_eq!(
            apply(&mut state, &actor, command),
            Err(RuleError::NoSequenceRemain)
        );
        assert_eq!(state, before);
    }

    #[test]
    fn sequence_exhaustion_is_atomic_for_every_event_transition() {
        let alice = id("alice");
        let host = id("host");
        assert_sequence_exhausted(lobby(), alice.clone(), crate::Command::Join);

        let mut drawn = started_with(Daub::Auto);
        assert_sequence_exhausted(drawn.clone(), host.clone(), crate::Command::Draw);
        apply(&mut drawn, &host, crate::Command::Draw).unwrap();
        assert_sequence_exhausted(drawn, host.clone(), crate::Command::Undo);

        assert_sequence_exhausted(lobby(), host.clone(), crate::Command::Close);

        let mut leave = lobby();
        apply(&mut leave, &alice, crate::Command::Join).unwrap();
        assert_sequence_exhausted(leave, alice.clone(), crate::Command::Leave);

        let mut kick = lobby();
        apply(&mut kick, &alice, crate::Command::Join).unwrap();
        assert_sequence_exhausted(
            kick,
            host.clone(),
            crate::Command::Kick {
                target: alice.clone(),
            },
        );

        let mut transfer = lobby();
        apply(&mut transfer, &alice, crate::Command::Join).unwrap();
        assert_sequence_exhausted(
            transfer,
            host,
            crate::Command::TransferHost {
                target: alice.clone(),
            },
        );

        assert_sequence_exhausted(claim_game(), alice, crate::Command::Claim { card_ix: 0 });
    }

    #[test]
    fn lobby_join_issues_the_configured_cards_once() {
        let mut rules = base_config();
        rules.cards_per_player = 3;
        let mut state = init(rules, [1; 32], id("host")).unwrap();
        let alice = id("alice");
        assert_eq!(
            apply(&mut state, &alice, crate::Command::Join),
            Ok(vec![Event::PlayerJoined {
                seq: 0,
                player: alice.clone(),
            }])
        );
        let participant = state
            .participants
            .iter()
            .find(|participant| participant.id == alice)
            .unwrap();
        assert_eq!(participant.cards.len(), 3);
        assert_eq!(
            participant
                .cards
                .iter()
                .map(|card| card.card_ix)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        let before = state.clone();
        assert_eq!(
            apply(&mut state, &alice, crate::Command::Join),
            Err(RuleError::AlreadyJoined)
        );
        assert_eq!(state, before);
    }

    #[test]
    fn late_join_policy_controls_backlog_marks() {
        let alice = id("alice");
        let host = id("host");

        let mut closed = lobby();
        closed.phase = Phase::Running;
        assert_eq!(
            apply(&mut closed, &alice, crate::Command::Join),
            Err(RuleError::RoomLocked)
        );

        let mut rules = base_config();
        rules.late_join = LateJoin::OpenNoBacklog;
        let mut no_backlog = init(rules, [1; 32], host.clone()).unwrap();
        no_backlog.phase = Phase::Running;
        let order = crate::draw_order(no_backlog.seed, no_backlog.config.size);
        let card = crate::generate_card(
            no_backlog.seed,
            &alice,
            0,
            no_backlog.config.size,
            no_backlog.config.free_center,
        );
        let draw_count = order
            .iter()
            .position(|number| {
                card.cells()
                    .iter()
                    .take(no_backlog.config.size.positions())
                    .any(|cell| cell == number)
            })
            .unwrap()
            + 1;
        for number in order.iter().take(draw_count) {
            no_backlog.drawn.insert(*number);
        }
        no_backlog.draw_index = draw_count;
        apply(&mut no_backlog, &alice, crate::Command::Join).unwrap();
        let participant = no_backlog.participants.first().unwrap();
        assert_eq!(participant.cards[0].draw_from, draw_count);
        assert_eq!(
            marks_of(&no_backlog, participant, &participant.cards[0]).popcount(),
            1,
            "only the free centre is marked at entry"
        );

        let mut open_rules = base_config();
        open_rules.late_join = LateJoin::Open;
        let mut open = init(open_rules, [1; 32], host).unwrap();
        open.phase = Phase::Running;
        for number in order.iter().take(draw_count) {
            open.drawn.insert(*number);
        }
        open.draw_index = draw_count;
        apply(&mut open, &alice, crate::Command::Join).unwrap();
        let participant = open.participants.first().unwrap();
        assert_eq!(participant.cards[0].draw_from, 0);
        assert!(marks_of(&open, participant, &participant.cards[0]).popcount() > 1);

        let mut manual_rules = base_config();
        manual_rules.daub = Daub::Manual;
        manual_rules.late_join = LateJoin::Open;
        let mut manual = init(manual_rules, [1; 32], id("host")).unwrap();
        manual.phase = Phase::Running;
        for number in order.iter().take(draw_count) {
            manual.drawn.insert(*number);
        }
        manual.draw_index = draw_count;
        apply(&mut manual, &alice, crate::Command::Join).unwrap();
        assert_eq!(manual.participants[0].cards[0].marks.popcount(), 1);
    }

    #[test]
    fn manual_late_arrivals_mark_their_own_cards_and_returners_resume() {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.late_join = LateJoin::Open;
        rules.win_limit = WinLimit::Unlimited;
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let mut state = init(rules, [1; 32], host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..10 {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }

        let original_cards = state.participants[0].cards.clone();
        apply(&mut state, &alice, crate::Command::Leave).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        assert_eq!(state.participants[0].cards, original_cards);

        apply(
            &mut state,
            &host,
            crate::Command::Kick {
                target: alice.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            apply(&mut state, &alice, crate::Command::Join),
            Err(RuleError::Kicked)
        );

        apply(&mut state, &bob, crate::Command::Join).unwrap();
        let bob_cards = &state
            .participants
            .iter()
            .find(|participant| participant.id == bob)
            .unwrap()
            .cards;
        assert!(
            bob_cards
                .iter()
                .all(|card| card.marks == initial_marks(BoardSize::S5, true))
        );
    }

    #[test]
    fn a_kick_outlasts_the_late_join_gate_a_departure_bypasses() {
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let mut state = init(base_config(), [1; 32], host.clone()).unwrap();
        assert_eq!(state.config.late_join, LateJoin::Closed);
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &bob, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        apply(&mut state, &host, crate::Command::Draw).unwrap();

        // A dropped connection still restores its card in a closed room.
        apply(&mut state, &bob, crate::Command::Leave).unwrap();
        apply(&mut state, &bob, crate::Command::Join).unwrap();

        apply(
            &mut state,
            &host,
            crate::Command::Kick {
                target: alice.clone(),
            },
        )
        .unwrap();
        assert!(state.departed_participants.is_empty());
        assert_eq!(state.kicked_participants, vec![alice.clone()]);
        let before = state.clone();
        assert_eq!(
            apply(&mut state, &alice, crate::Command::Join),
            Err(RuleError::Kicked)
        );
        assert_eq!(state, before);

        // Leaving first does not dodge the ban.
        apply(&mut state, &bob, crate::Command::Leave).unwrap();
        assert_eq!(
            apply(
                &mut state,
                &host,
                crate::Command::Kick {
                    target: bob.clone(),
                },
            ),
            Ok(vec![Event::PlayerKicked {
                seq: state.next_seq - 1,
                actor: host.clone(),
                target: bob.clone(),
            }])
        );
        assert!(state.departed_participants.is_empty());
        assert_eq!(state.kicked_participants, vec![alice, bob.clone()]);
        assert_eq!(
            apply(&mut state, &bob, crate::Command::Join),
            Err(RuleError::Kicked)
        );
        assert_eq!(
            apply(&mut state, &host, crate::Command::Kick { target: id("ghost") }),
            Err(RuleError::NotAParticipant)
        );
    }

    #[test]
    fn undo_revokes_marks_for_departed_but_not_kicked_participants() {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.win_limit = WinLimit::Unlimited;
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let mut state = init(rules, [1; 32], host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &bob, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        let alice_card = crate::generate_card(
            state.seed,
            &alice,
            0,
            state.config.size,
            state.config.free_center,
        );
        let bob_card = crate::generate_card(
            state.seed,
            &bob,
            0,
            state.config.size,
            state.config.free_center,
        );
        let (number, alice_at, bob_at) = loop {
            let number = next_number(&state);
            apply(&mut state, &host, crate::Command::Draw).unwrap();
            if let Some(alice_at) = alice_card.position_of(number)
                && let Some(bob_at) = bob_card.position_of(number)
            {
                break (number, alice_at, bob_at);
            }
        };
        state.participants[0].cards[0]
            .marks
            .set(alice_at.0, alice_at.1)
            .unwrap();
        state.participants[1].cards[0]
            .marks
            .set(bob_at.0, bob_at.1)
            .unwrap();

        apply(
            &mut state,
            &host,
            crate::Command::Kick {
                target: alice.clone(),
            },
        )
        .unwrap();
        apply(&mut state, &bob, crate::Command::Leave).unwrap();
        let events = apply(&mut state, &host, crate::Command::Undo).unwrap();
        // A kicked player can never rejoin, so their card is frozen where the
        // kick left it and no revocation is reported for them.
        assert!(matches!(
            events.as_slice(),
            [Event::DrawUndone { number: undone, revoked, .. }]
                if *undone == number
                    && revoked
                        == &vec![crate::RevokedMark {
                            player: bob.clone(),
                            card_ix: 0,
                            row: bob_at.0,
                            col: bob_at.1,
                        }]
        ));
        assert!(
            !state.departed_participants[0].cards[0]
                .marks
                .get(bob_at.0, bob_at.1)
        );
    }

    #[test]
    fn returning_participant_keeps_marks_and_backlog_boundary() {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.late_join = LateJoin::OpenNoBacklog;
        rules.win_limit = WinLimit::Unlimited;
        let host = id("host");
        let alice = id("alice");
        let starter = id("starter");
        let mut state = init(rules, [1; 32], host.clone()).unwrap();
        apply(&mut state, &starter, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..5 {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        let (_, row, col) = draw_until_card_hit(&mut state, &alice);
        apply(
            &mut state,
            &alice,
            crate::Command::Mark {
                card_ix: 0,
                row,
                col,
            },
        )
        .unwrap();
        let participant = state
            .participants
            .iter()
            .find(|participant| participant.id == alice)
            .unwrap()
            .clone();

        apply(&mut state, &alice, crate::Command::Leave).unwrap();
        apply(&mut state, &host, crate::Command::Draw).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();

        assert_eq!(
            state
                .participants
                .iter()
                .find(|current| current.id == alice),
            Some(&participant)
        );
    }

    #[test]
    fn an_open_late_join_can_win_at_the_join_sequence() {
        let alice = id("alice");
        let host = id("host");
        let seed = [1; 32];
        let card = crate::generate_card(seed, &alice, 0, BoardSize::S5, true);
        let order = crate::draw_order(seed, BoardSize::S5);
        let (draw_offset, position) = order
            .iter()
            .enumerate()
            .find_map(|(draw_offset, number)| {
                card.cells()
                    .iter()
                    .take(BoardSize::S5.positions())
                    .position(|cell| cell == number)
                    .map(|position| (draw_offset, position))
            })
            .unwrap();
        let mut rules = base_config();
        rules.late_join = LateJoin::Open;
        rules.patterns = vec![1u128 << position];
        let mut state = init(rules, seed, host).unwrap();
        state.phase = Phase::Running;
        for number in order.iter().take(draw_offset + 1) {
            state.drawn.insert(*number);
        }
        state.draw_index = draw_offset + 1;

        let events = apply(&mut state, &alice, crate::Command::Join).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[1],
            Event::WinRecognized {
                seq: 1,
                winners: vec![alice],
                patterns: vec![1u128 << position],
                at_seq: 0,
                rank: 1,
            }
        );
        assert_eq!(state.phase(), Phase::Finished);
    }

    #[test]
    fn a_recognized_card_pattern_cannot_win_again_after_rejoin() {
        let seed = [1; 32];
        let host = id("host");
        let alice = id("alice");
        let card = crate::generate_card(seed, &alice, 0, BoardSize::S5, true);
        let order = crate::draw_order(seed, BoardSize::S5);
        let (draw_offset, position) = card
            .cells()
            .iter()
            .copied()
            .take(BoardSize::S5.positions())
            .enumerate()
            .filter(|(_, number)| *number != 0)
            .map(|(position, number)| {
                (
                    order.iter().position(|drawn| *drawn == number).unwrap(),
                    position,
                )
            })
            .min()
            .unwrap();
        let mut rules = base_config();
        rules.late_join = LateJoin::Open;
        rules.win_limit = WinLimit::Count(3);
        rules.patterns = vec![1u128 << position];
        let mut state = init(rules, seed, host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..=draw_offset {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }
        assert_eq!(state.wins().len(), 1);

        for _ in 0..2 {
            apply(&mut state, &alice, crate::Command::Leave).unwrap();
            let events = apply(&mut state, &alice, crate::Command::Join).unwrap();
            assert_eq!(events.len(), 1);
        }

        assert_eq!(state.wins().len(), 1);
        assert_eq!(state.phase(), Phase::Running);
        assert_eq!(crate::project_player(&state, &alice).revealed_seed, None);
    }

    #[test]
    fn one_identity_can_win_distinct_patterns_without_exhausting_a_count_limit() {
        let seed = [1; 32];
        let host = id("host");
        let alice = id("alice");
        let card = crate::generate_card(seed, &alice, 0, BoardSize::S5, true);
        let order = crate::draw_order(seed, BoardSize::S5);
        let mut positions: Vec<(usize, usize)> = card
            .cells()
            .iter()
            .copied()
            .take(BoardSize::S5.positions())
            .enumerate()
            .filter(|(_, number)| *number != 0)
            .map(|(position, number)| {
                (
                    order.iter().position(|drawn| *drawn == number).unwrap(),
                    position,
                )
            })
            .collect();
        positions.sort_unstable();
        let first = positions[0];
        let second = positions[1];
        let mut rules = base_config();
        rules.win_limit = WinLimit::Count(2);
        rules.patterns = vec![1u128 << first.1, 1u128 << second.1];
        let mut state = init(rules, seed, host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..=second.0 {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }

        assert_eq!(state.wins().len(), 2);
        assert_eq!(state.phase(), Phase::Running);
    }

    #[test]
    fn the_same_pattern_can_win_once_on_each_card() {
        let seed = [1; 32];
        let host = id("host");
        let alice = id("alice");
        let first = crate::generate_card(seed, &alice, 0, BoardSize::S5, true);
        let second = crate::generate_card(seed, &alice, 1, BoardSize::S5, true);
        let position = (0..BoardSize::S5.positions())
            .find(|position| {
                let first_number = first.cells()[*position];
                let second_number = second.cells()[*position];
                first_number != 0 && first_number != second_number
            })
            .unwrap();
        let mut rules = base_config();
        rules.cards_per_player = 2;
        rules.win_limit = WinLimit::Unlimited;
        rules.patterns = vec![1u128 << position];
        let mut state = init(rules, seed, host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..usize::from(BoardSize::S5.max_number()) {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }

        assert_eq!(state.wins().len(), 2);
        assert_eq!(state.wins()[0].patterns, state.wins()[1].patterns);
    }

    #[test]
    fn join_rejects_finished_games_before_card_creation() {
        let mut state = lobby();
        state.phase = Phase::Finished;
        let before = state.clone();
        assert_eq!(
            apply(&mut state, &id("alice"), crate::Command::Join),
            Err(RuleError::WrongPhase)
        );
        assert_eq!(state, before);
    }

    fn started_with(daub: Daub) -> crate::GameState {
        let mut rules = base_config();
        rules.daub = daub;
        rules.win_limit = WinLimit::Unlimited;
        let mut state = init(rules, [1; 32], id("host")).unwrap();
        apply(&mut state, &id("alice"), crate::Command::Join).unwrap();
        apply(&mut state, &id("host"), crate::Command::Start).unwrap();
        state
    }

    fn next_number(state: &crate::GameState) -> u8 {
        crate::draw_order(state.seed, state.config.size)
            .into_iter()
            .nth(state.draw_index)
            .unwrap()
    }

    #[test]
    fn undo_rewinds_the_committed_draw_pointer() {
        let mut state = started_with(Daub::Auto);
        let host = id("host");
        let first = next_number(&state);
        apply(&mut state, &host, crate::Command::Draw).unwrap();
        let undone = apply(&mut state, &host, crate::Command::Undo).unwrap();
        assert!(matches!(
            undone.as_slice(),
            [Event::DrawUndone {
                number,
                revoked,
                ..
            }] if *number == first && revoked.is_empty()
        ));
        let again = next_number(&state);
        apply(&mut state, &host, crate::Command::Draw).unwrap();
        assert_eq!(again, first);
        assert!(state.drawn().contains(first));
    }

    #[test]
    fn a_redraw_after_late_join_is_not_treated_as_backlog() {
        let mut rules = base_config();
        rules.late_join = LateJoin::OpenNoBacklog;
        rules.win_limit = WinLimit::Unlimited;
        let seed = [1; 32];
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let bob_card = crate::generate_card(seed, &bob, 0, rules.size, rules.free_center);
        let order = crate::draw_order(seed, rules.size);
        let target_offset = order
            .iter()
            .position(|number| {
                bob_card
                    .cells()
                    .iter()
                    .take(rules.size.positions())
                    .any(|cell| cell == number)
            })
            .unwrap();
        let mut state = init(rules, seed, host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..=target_offset {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }
        apply(&mut state, &bob, crate::Command::Join).unwrap();
        let bob_state = state
            .participants
            .iter()
            .find(|participant| participant.id == bob)
            .unwrap();
        assert_eq!(
            marks_of(&state, bob_state, &bob_state.cards[0]).popcount(),
            1
        );

        apply(&mut state, &host, crate::Command::Undo).unwrap();
        apply(&mut state, &host, crate::Command::Draw).unwrap();
        let bob_state = state
            .participants
            .iter()
            .find(|participant| participant.id == bob)
            .unwrap();
        assert_eq!(
            marks_of(&state, bob_state, &bob_state.cards[0]).popcount(),
            2,
            "the redrawn number was emitted after the player joined"
        );
    }

    #[test]
    fn manual_marks_enforce_the_backlog_boundary_but_allow_a_redraw() {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.late_join = LateJoin::OpenNoBacklog;
        rules.win_limit = WinLimit::Unlimited;
        let seed = [1; 32];
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let bob_card = crate::generate_card(seed, &bob, 0, rules.size, rules.free_center);
        let order = crate::draw_order(seed, rules.size);
        let (draw_offset, row, col) = order
            .iter()
            .enumerate()
            .find_map(|(draw_offset, number)| {
                bob_card
                    .position_of(*number)
                    .map(|(row, col)| (draw_offset, row, col))
            })
            .unwrap();
        let command = crate::Command::Mark {
            card_ix: 0,
            row,
            col,
        };
        let mut state = init(rules, seed, host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        for _ in 0..=draw_offset {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }
        apply(&mut state, &bob, crate::Command::Join).unwrap();

        let before = state.clone();
        assert_eq!(
            apply(&mut state, &bob, command.clone()),
            Err(RuleError::BacklogMarkNotAllowed)
        );
        assert_eq!(state, before);

        apply(&mut state, &host, crate::Command::Undo).unwrap();
        apply(&mut state, &host, crate::Command::Draw).unwrap();
        assert!(apply(&mut state, &bob, command).is_ok());
    }

    #[test]
    fn undo_revokes_manual_marks_for_the_undone_number() {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.cards_per_player = 2;
        rules.win_limit = WinLimit::Unlimited;
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let mut state = init(rules, [1; 32], host.clone()).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &bob, crate::Command::Join).unwrap();
        apply(&mut state, &host, crate::Command::Start).unwrap();
        let card = crate::generate_card(
            state.seed,
            &alice,
            0,
            state.config.size,
            state.config.free_center,
        );
        let other_card = crate::generate_card(
            state.seed,
            &alice,
            1,
            state.config.size,
            state.config.free_center,
        );
        let bob_card = crate::generate_card(
            state.seed,
            &bob,
            0,
            state.config.size,
            state.config.free_center,
        );
        let (number, row, col) = loop {
            let number = next_number(&state);
            apply(&mut state, &host, crate::Command::Draw).unwrap();
            let absent_from_other = other_card.position_of(number).is_none();
            let present_on_unmarked = bob_card.position_of(number).is_some();
            let position = card
                .position_of(number)
                .filter(|_| absent_from_other && present_on_unmarked);
            if let Some((row, col)) = position {
                break (number, row, col);
            }
        };
        state.participants[0].cards[0].marks.set(row, col).unwrap();

        let events = apply(&mut state, &host, crate::Command::Undo).unwrap();
        assert_eq!(
            events.as_slice(),
            [Event::DrawUndone {
                seq: state.next_seq - 1,
                actor: host,
                number,
                revoked: vec![crate::RevokedMark {
                    player: alice,
                    card_ix: 0,
                    row,
                    col,
                }],
            }]
        );
        assert!(!state.participants[0].cards[0].marks.get(row, col));
        assert!(!state.drawn().contains(number));
    }

    #[test]
    fn draw_and_undo_reject_invalid_pointer_states() {
        let mut state = started_with(Daub::Auto);
        let host = id("host");
        assert_eq!(
            apply(&mut state, &host, crate::Command::Undo),
            Err(RuleError::NothingToUndo)
        );

        let remaining = usize::from(state.config.size.max_number());
        for _ in 0..remaining {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }
        assert_eq!(
            apply(&mut state, &host, crate::Command::Draw),
            Err(RuleError::NoNumbersRemain)
        );
        state.phase = Phase::Finished;
        assert_eq!(
            apply(&mut state, &host, crate::Command::Undo),
            Err(RuleError::WrongPhase)
        );

        let mut missing_history = started_with(Daub::Auto);
        missing_history.draw_index = 1;
        assert_eq!(
            apply(&mut missing_history, &host, crate::Command::Undo),
            Err(RuleError::NothingToUndo)
        );

        let mut invalid_index = started_with(Daub::Auto);
        invalid_index.draw_index = usize::MAX;
        invalid_index.draw_seqs.push(0);
        assert_eq!(
            apply(&mut invalid_index, &host, crate::Command::Undo),
            Err(RuleError::NothingToUndo)
        );
    }

    fn draw_until_card_hit(state: &mut crate::GameState, player: &PlayerId) -> (u8, usize, usize) {
        let card = crate::generate_card(
            state.seed,
            player,
            0,
            state.config.size,
            state.config.free_center,
        );
        loop {
            let number = next_number(state);
            apply(state, &id("host"), crate::Command::Draw).unwrap();
            if let Some((row, col)) = card.position_of(number) {
                return (number, row, col);
            }
        }
    }

    #[test]
    fn mark_validation_rejects_each_invalid_input_before_mutation() {
        let mut state = started_with(Daub::Manual);
        let alice = id("alice");
        let bob = id("bob");
        let (_, drawn_row, drawn_col) = draw_until_card_hit(&mut state, &alice);
        let card = crate::generate_card(
            state.seed,
            &alice,
            0,
            state.config.size,
            state.config.free_center,
        );
        let side = usize::from(state.config.size.as_u8());
        let undrawn_number = card
            .cells()
            .iter()
            .copied()
            .take(state.config.size.positions())
            .find(|number| *number != 0 && !state.drawn.contains(*number))
            .unwrap();
        let (undrawn_row, undrawn_col) = card.position_of(undrawn_number).unwrap();
        let before = state.clone();
        assert_eq!(
            apply(
                &mut state,
                &alice,
                crate::Command::Mark {
                    card_ix: 0,
                    row: undrawn_row,
                    col: undrawn_col,
                },
            ),
            Err(RuleError::NumberNotDrawn)
        );
        assert_eq!(state, before);
        assert_eq!(
            apply(
                &mut state,
                &bob,
                crate::Command::Mark {
                    card_ix: 0,
                    row: drawn_row,
                    col: drawn_col,
                },
            ),
            Err(RuleError::UnknownCard)
        );
        assert_eq!(
            apply(
                &mut state,
                &alice,
                crate::Command::Mark {
                    card_ix: 0,
                    row: 200,
                    col: usize::MAX,
                },
            ),
            Err(RuleError::NoSuchPosition)
        );
        assert_eq!(
            apply(
                &mut state,
                &alice,
                crate::Command::Mark {
                    card_ix: 99,
                    row: 0,
                    col: 0,
                },
            ),
            Err(RuleError::UnknownCard)
        );
        assert_eq!(
            apply(
                &mut state,
                &alice,
                crate::Command::Mark {
                    card_ix: 0,
                    row: side / 2,
                    col: side / 2,
                },
            ),
            Err(RuleError::NumberNotOnCard)
        );
    }

    #[test]
    fn manual_mark_and_unmark_emit_events_and_change_owned_marks() {
        let mut state = started_with(Daub::Manual);
        let alice = id("alice");
        let (_, row, col) = draw_until_card_hit(&mut state, &alice);
        let placed = apply(
            &mut state,
            &alice,
            crate::Command::Mark {
                card_ix: 0,
                row,
                col,
            },
        )
        .unwrap();
        assert!(matches!(
            placed.as_slice(),
            [Event::MarkPlaced {
                player,
                card_ix: 0,
                row: event_row,
                col: event_col,
                ..
            }] if player == &alice && *event_row == row && *event_col == col
        ));
        assert!(state.participants[0].cards[0].marks.get(row, col));

        let removed = apply(
            &mut state,
            &alice,
            crate::Command::Unmark {
                card_ix: 0,
                row,
                col,
            },
        )
        .unwrap();
        assert!(matches!(removed.as_slice(), [Event::MarkRemoved { .. }]));
        assert!(!state.participants[0].cards[0].marks.get(row, col));
    }

    #[test]
    fn daub_mode_and_phase_are_checked_before_card_coordinates() {
        let mut automatic = lobby();
        assert_eq!(
            apply(
                &mut automatic,
                &id("alice"),
                crate::Command::Mark {
                    card_ix: 255,
                    row: usize::MAX,
                    col: usize::MAX,
                },
            ),
            Err(RuleError::ManualDaubDisabled)
        );

        let mut rules = base_config();
        rules.daub = Daub::Manual;
        let mut manual_lobby = init(rules, [1; 32], id("host")).unwrap();
        assert_eq!(
            apply(
                &mut manual_lobby,
                &id("alice"),
                crate::Command::Unmark {
                    card_ix: 0,
                    row: 0,
                    col: 0,
                },
            ),
            Err(RuleError::WrongPhase)
        );
    }

    #[test]
    fn mark_rejects_sequence_exhaustion_before_changing_marks() {
        let mut state = started_with(Daub::Manual);
        let alice = id("alice");
        let (_, row, col) = draw_until_card_hit(&mut state, &alice);
        state.next_seq = u64::MAX;
        let before = state.clone();
        assert_eq!(
            apply(
                &mut state,
                &alice,
                crate::Command::Mark {
                    card_ix: 0,
                    row,
                    col,
                },
            ),
            Err(RuleError::NoSequenceRemain)
        );
        assert_eq!(state, before);
    }

    fn common_draw_for(
        seed: [u8; 32],
        first: &PlayerId,
        second: &PlayerId,
    ) -> (usize, usize, usize) {
        let first_card = crate::generate_card(seed, first, 0, BoardSize::S5, true);
        let second_card = crate::generate_card(seed, second, 0, BoardSize::S5, true);
        crate::draw_order(seed, BoardSize::S5)
            .iter()
            .enumerate()
            .find_map(|(draw_offset, number)| {
                let first_position = first_card
                    .cells()
                    .iter()
                    .take(BoardSize::S5.positions())
                    .position(|cell| cell == number)?;
                let second_position = second_card
                    .cells()
                    .iter()
                    .take(BoardSize::S5.positions())
                    .position(|cell| cell == number)?;
                Some((draw_offset, first_position, second_position))
            })
            .unwrap()
    }

    fn game_rigged_for_two_way_auto_win(limit: WinLimit) -> crate::GameState {
        let seed = [1; 32];
        let alice = id("alice");
        let bob = id("bob");
        let (draw_offset, alice_position, bob_position) = common_draw_for(seed, &alice, &bob);
        let mut rules = base_config();
        rules.late_join = LateJoin::OpenNoBacklog;
        rules.win_limit = limit;
        rules.patterns = vec![1u128 << alice_position, 1u128 << bob_position];
        let mut state = init(rules, seed, id("host")).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &bob, crate::Command::Join).unwrap();
        apply(&mut state, &id("host"), crate::Command::Start).unwrap();
        let order = crate::draw_order(seed, BoardSize::S5);
        for number in order.iter().take(draw_offset) {
            state.drawn.insert(*number);
        }
        state.draw_index = draw_offset;
        for participant in &mut state.participants {
            for card in &mut participant.cards {
                card.draw_from = draw_offset;
            }
        }
        state
    }

    #[test]
    fn simultaneous_winners_share_rank_and_the_next_rank_skips() {
        let mut state = game_rigged_for_two_way_auto_win(WinLimit::Unlimited);
        let host = id("host");
        let events = apply(&mut state, &host, crate::Command::Draw).unwrap();
        let win = events
            .iter()
            .find_map(|event| match event {
                Event::WinRecognized { winners, rank, .. } => Some((winners, rank)),
                _ => None,
            })
            .unwrap();
        assert_eq!(win.0.len(), 2);
        assert_eq!(*win.1, 1);

        let carol = id("carol");
        apply(&mut state, &carol, crate::Command::Join).unwrap();
        let card = crate::generate_card(
            state.seed,
            &carol,
            0,
            state.config.size,
            state.config.free_center,
        );
        let order = crate::draw_order(state.seed, state.config.size);
        let (future_offset, position) = order
            .iter()
            .enumerate()
            .skip(state.draw_index)
            .find_map(|(offset, number)| {
                card.cells()
                    .iter()
                    .take(state.config.size.positions())
                    .position(|cell| cell == number)
                    .map(|position| (offset, position))
            })
            .unwrap();
        state.config.patterns.push(1u128 << position);
        state.draw_index = future_offset;
        state
            .participants
            .iter_mut()
            .find(|participant| participant.id == carol)
            .unwrap()
            .cards[0]
            .draw_from = future_offset;
        let events = apply(&mut state, &host, crate::Command::Draw).unwrap();
        let rank = events.iter().find_map(|event| match event {
            Event::WinRecognized { rank, .. } => Some(*rank),
            _ => None,
        });
        assert_eq!(rank, Some(3));
    }

    #[test]
    fn a_count_limit_can_overshoot_on_a_tie() {
        let mut state = lobby();
        state.config.win_limit = WinLimit::Count(3);
        state.phase = Phase::Running;
        let mut events = Vec::new();
        recognize_players(
            &mut state,
            vec![
                recognition(id("alice"), vec![1]),
                recognition(id("bob"), vec![1]),
            ],
            0,
            1,
            &mut events,
        );
        assert_eq!(state.phase(), Phase::Running);
        recognize_players(
            &mut state,
            vec![
                recognition(id("carol"), vec![2]),
                recognition(id("dave"), vec![2]),
            ],
            2,
            3,
            &mut events,
        );
        assert_eq!(state.phase(), Phase::Finished);
        assert_eq!(
            state
                .wins()
                .iter()
                .map(|win| win.winners.len())
                .sum::<usize>(),
            4
        );
        assert_eq!(state.wins()[1].rank, 3);
    }

    fn claim_game() -> crate::GameState {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.win_detection = WinDetection::Claim;
        rules.win_limit = WinLimit::Unlimited;
        rules.patterns = vec![1];
        let mut state = init(rules, [1; 32], id("host")).unwrap();
        apply(&mut state, &id("alice"), crate::Command::Join).unwrap();
        apply(&mut state, &id("bob"), crate::Command::Join).unwrap();
        apply(&mut state, &id("host"), crate::Command::Start).unwrap();
        state.participants[0].cards[0].marks.set(0, 0).unwrap();
        state.participants[1].cards[0].marks.set(0, 0).unwrap();
        state
    }

    #[test]
    fn claim_mode_ranks_by_arrival_and_rejects_false_or_duplicate_claims() {
        let mut false_claim = claim_game();
        false_claim.participants[0].cards[0]
            .marks
            .clear(0, 0)
            .unwrap();
        assert_eq!(
            apply(
                &mut false_claim,
                &id("alice"),
                crate::Command::Claim { card_ix: 0 },
            ),
            Err(RuleError::NoBingo)
        );

        let mut state = claim_game();
        let bob_events =
            apply(&mut state, &id("bob"), crate::Command::Claim { card_ix: 0 }).unwrap();
        assert!(matches!(
            bob_events.as_slice(),
            [
                Event::BingoClaimed { .. },
                Event::WinRecognized { rank: 1, .. }
            ]
        ));
        let alice_events = apply(
            &mut state,
            &id("alice"),
            crate::Command::Claim { card_ix: 0 },
        )
        .unwrap();
        assert!(matches!(
            alice_events.as_slice(),
            [
                Event::BingoClaimed { .. },
                Event::WinRecognized { rank: 2, .. }
            ]
        ));
        assert_eq!(state.wins()[0].winners, vec![id("bob")]);
        assert_eq!(
            apply(&mut state, &id("bob"), crate::Command::Claim { card_ix: 0 },),
            Err(RuleError::WinAlreadyRecognised)
        );
    }

    #[test]
    fn claim_validates_phase_player_and_card() {
        let mut state = claim_game();
        state.phase = Phase::Lobby;
        assert_eq!(
            apply(
                &mut state,
                &id("alice"),
                crate::Command::Claim { card_ix: 0 },
            ),
            Err(RuleError::WrongPhase)
        );
        state.phase = Phase::Running;
        assert_eq!(
            apply(
                &mut state,
                &id("nobody"),
                crate::Command::Claim { card_ix: 0 },
            ),
            Err(RuleError::UnknownCard)
        );
        assert_eq!(
            apply(
                &mut state,
                &id("alice"),
                crate::Command::Claim { card_ix: 255 },
            ),
            Err(RuleError::UnknownCard)
        );
    }

    #[test]
    fn claim_is_the_only_recognition_path_in_claim_mode() {
        let mut state = claim_game();
        assert!(state.wins().is_empty());
        let host = id("host");
        let _ = apply(&mut state, &host, crate::Command::Draw).unwrap();
        assert!(state.wins().is_empty());

        let mut automatic = started_with(Daub::Auto);
        assert_eq!(
            apply(
                &mut automatic,
                &id("alice"),
                crate::Command::Claim { card_ix: 0 },
            ),
            Err(RuleError::ClaimDisabled)
        );
    }

    #[test]
    fn manual_daub_win_is_recognized_on_mark_and_blocks_undo() {
        let mut rules = base_config();
        rules.daub = Daub::Manual;
        rules.win_limit = WinLimit::Unlimited;
        let alice = id("alice");
        let seed = [1; 32];
        let card = crate::generate_card(seed, &alice, 0, rules.size, rules.free_center);
        let order = crate::draw_order(seed, rules.size);
        let side = usize::from(rules.size.as_u8());
        let (draw_offset, row, col) = order
            .iter()
            .enumerate()
            .find_map(|(offset, number)| {
                card.position_of(*number)
                    .map(|(row, col)| (offset, row, col))
            })
            .unwrap();
        rules.patterns = vec![1u128 << (row * side + col)];
        let mut state = init(rules, seed, id("host")).unwrap();
        apply(&mut state, &alice, crate::Command::Join).unwrap();
        apply(&mut state, &id("host"), crate::Command::Start).unwrap();
        for _ in 0..=draw_offset {
            apply(&mut state, &id("host"), crate::Command::Draw).unwrap();
        }
        let events = apply(
            &mut state,
            &alice,
            crate::Command::Mark {
                card_ix: 0,
                row,
                col,
            },
        )
        .unwrap();
        assert!(matches!(
            events.as_slice(),
            [Event::MarkPlaced { seq, .. }, Event::WinRecognized { at_seq, .. }]
                if seq == at_seq
        ));
        assert_eq!(
            apply(&mut state, &id("host"), crate::Command::Undo),
            Err(RuleError::WinAlreadyRecognised)
        );
    }

    #[test]
    fn no_command_panics_on_extreme_client_inputs() {
        let mut state = started_with(Daub::Manual);
        let alice = id("alice");
        for card_ix in [0u8, 1, 200, 255] {
            for row in [0usize, 4, 80, 200, usize::MAX] {
                for col in [0usize, 4, 80, 200, usize::MAX] {
                    let _ = apply(
                        &mut state,
                        &alice,
                        crate::Command::Mark { card_ix, row, col },
                    );
                    let _ = apply(
                        &mut state,
                        &alice,
                        crate::Command::Unmark { card_ix, row, col },
                    );
                }
            }
        }

        let mut claims = claim_game();
        for card_ix in [0u8, 1, 200, 255] {
            let _ = apply(&mut claims, &alice, crate::Command::Claim { card_ix });
        }
        for command in [
            crate::Command::Join,
            crate::Command::Leave,
            crate::Command::Start,
            crate::Command::Draw,
            crate::Command::Undo,
            crate::Command::Kick {
                target: id("nobody"),
            },
            crate::Command::TransferHost {
                target: id("nobody"),
            },
            crate::Command::Close,
        ] {
            let _ = apply(&mut state, &alice, command);
        }
    }

    #[test]
    fn drawing_past_the_end_is_a_total_error() {
        let mut state = started_with(Daub::Auto);
        let host = id("host");
        for _ in 0..usize::from(BoardSize::S5.max_number()) {
            apply(&mut state, &host, crate::Command::Draw).unwrap();
        }
        assert_eq!(
            apply(&mut state, &host, crate::Command::Draw),
            Err(RuleError::NoNumbersRemain)
        );
    }
}
