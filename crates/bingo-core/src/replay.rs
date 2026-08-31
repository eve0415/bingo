use crate::{Command, Event, GameConfig, GameState, PlayerId, RuleError, apply, init};

/// Rebuilds a game by checking every recorded event against the reducer.
pub fn replay(
    config: &GameConfig,
    seed: [u8; 32],
    host: &PlayerId,
    log: &[Event],
) -> Result<GameState, RuleError> {
    let mut state = init(config.clone(), seed, host.clone()).map_err(|_| RuleError::LogMismatch)?;
    let mut offset = 0usize;
    while let Some(event) = log.get(offset) {
        let (actor, command) = command_for(event)?;
        let produced = apply(&mut state, &actor, command)?;
        let end = offset.saturating_add(produced.len());
        let Some(recorded) = log.get(offset..end) else {
            return Err(RuleError::LogMismatch);
        };
        if produced != recorded {
            return Err(RuleError::LogMismatch);
        }
        offset = end;
    }
    Ok(state)
}

fn command_for(event: &Event) -> Result<(PlayerId, Command), RuleError> {
    let transition = match event {
        Event::PlayerJoined { player, .. } => (player.clone(), Command::Join),
        Event::PlayerLeft { player, .. } => (player.clone(), Command::Leave),
        Event::MarkPlaced {
            player,
            card_ix,
            row,
            col,
            ..
        } => (
            player.clone(),
            Command::Mark {
                card_ix: *card_ix,
                row: *row,
                col: *col,
            },
        ),
        Event::MarkRemoved {
            player,
            card_ix,
            row,
            col,
            ..
        } => (
            player.clone(),
            Command::Unmark {
                card_ix: *card_ix,
                row: *row,
                col: *col,
            },
        ),
        Event::BingoClaimed {
            player, card_ix, ..
        } => (player.clone(), Command::Claim { card_ix: *card_ix }),
        Event::GameStarted { actor, .. } => (actor.clone(), Command::Start),
        Event::NumberDrawn { actor, .. } => (actor.clone(), Command::Draw),
        Event::DrawUndone { actor, .. } => (actor.clone(), Command::Undo),
        Event::PlayerKicked { actor, target, .. } => (
            actor.clone(),
            Command::Kick {
                target: target.clone(),
            },
        ),
        Event::HostTransferred { actor, target, .. } => (
            actor.clone(),
            Command::TransferHost {
                target: target.clone(),
            },
        ),
        Event::GameClosed { actor, .. } => (actor.clone(), Command::Close),
        Event::WinRecognized { .. } => return Err(RuleError::LogMismatch),
    };
    Ok(transition)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{base_config, id};
    use crate::{
        BoardSize, Command, Daub, Event, GameConfig, GameState, LateJoin, WinDetection, WinLimit,
        apply, generate_card, init,
    };

    fn config(daub: Daub) -> GameConfig {
        GameConfig {
            daub,
            late_join: LateJoin::OpenNoBacklog,
            win_limit: WinLimit::Unlimited,
            ..base_config()
        }
    }

    fn record(state: &mut GameState, log: &mut Vec<Event>, actor: &PlayerId, command: Command) {
        log.extend(apply(state, actor, command).unwrap());
    }

    fn play_finished_game() -> (GameConfig, GameState, Vec<Event>) {
        let rules = config(Daub::Auto);
        let host = id("host");
        let mut state = init(rules.clone(), [1; 32], host.clone()).unwrap();
        let mut log = Vec::new();
        record(&mut state, &mut log, &id("alice"), Command::Join);
        record(&mut state, &mut log, &id("bob"), Command::Join);
        record(&mut state, &mut log, &host, Command::Start);
        for _ in 0..8 {
            record(&mut state, &mut log, &host, Command::Draw);
        }
        record(&mut state, &mut log, &host, Command::Close);
        (rules, state, log)
    }

    #[test]
    fn replaying_a_log_reproduces_the_state_exactly() {
        let (rules, state, log) = play_finished_game();
        assert_eq!(replay(&rules, [1; 32], &id("host"), &log).unwrap(), state);
    }

    #[test]
    fn replay_survives_undo_and_manual_mark_revocation() {
        let rules = config(Daub::Manual);
        let host = id("host");
        let alice = id("alice");
        let mut state = init(rules.clone(), [1; 32], host.clone()).unwrap();
        let mut log = Vec::new();
        record(&mut state, &mut log, &alice, Command::Join);
        record(&mut state, &mut log, &host, Command::Start);
        let card = generate_card([1; 32], &alice, 0, rules.size, rules.free_center);
        let order = crate::draw_order([1; 32], rules.size);
        let (row, col) = loop {
            let number = order.get(state.draw_index).copied().unwrap();
            record(&mut state, &mut log, &host, Command::Draw);
            if let Some(position) = card.position_of(number) {
                break position;
            }
        };
        record(
            &mut state,
            &mut log,
            &alice,
            Command::Mark {
                card_ix: 0,
                row,
                col,
            },
        );
        record(
            &mut state,
            &mut log,
            &alice,
            Command::Unmark {
                card_ix: 0,
                row,
                col,
            },
        );
        record(
            &mut state,
            &mut log,
            &alice,
            Command::Mark {
                card_ix: 0,
                row,
                col,
            },
        );
        record(&mut state, &mut log, &host, Command::Undo);
        assert_eq!(replay(&rules, [1; 32], &host, &log).unwrap(), state);
    }

    #[test]
    fn replay_rejects_a_tampered_draw() {
        let (rules, _, mut log) = play_finished_game();
        for event in &mut log {
            if let Event::NumberDrawn { number, .. } = event {
                *number = number.saturating_add(1);
                break;
            }
        }
        assert!(replay(&rules, [1; 32], &id("host"), &log).is_err());
    }

    #[test]
    fn replay_accepts_leave_kick_and_host_transfer_events() {
        let rules = config(Daub::Auto);
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let carol = id("carol");
        let mut state = init(rules.clone(), [1; 32], host.clone()).unwrap();
        let mut log = Vec::new();
        record(&mut state, &mut log, &alice, Command::Join);
        record(&mut state, &mut log, &bob, Command::Join);
        record(&mut state, &mut log, &carol, Command::Join);
        record(
            &mut state,
            &mut log,
            &host,
            Command::TransferHost {
                target: alice.clone(),
            },
        );
        record(&mut state, &mut log, &bob, Command::Leave);
        record(
            &mut state,
            &mut log,
            &alice,
            Command::Kick { target: carol },
        );
        record(&mut state, &mut log, &alice, Command::Close);
        assert_eq!(replay(&rules, [1; 32], &host, &log).unwrap(), state);
    }

    fn claimed_game() -> (GameConfig, GameState, Vec<Event>) {
        let mut rules = config(Daub::Manual);
        rules.win_detection = WinDetection::Claim;
        let host = id("host");
        let alice = id("alice");
        let seed = [1; 32];
        let card = generate_card(seed, &alice, 0, rules.size, rules.free_center);
        let order = crate::draw_order(seed, rules.size);
        let side = usize::from(rules.size.as_u8());
        let (draw_offset, row, col) = order
            .iter()
            .enumerate()
            .find_map(|(draw_offset, number)| {
                card.position_of(*number)
                    .map(|(row, col)| (draw_offset, row, col))
            })
            .unwrap();
        rules.patterns = vec![1u128 << (row * side + col)];
        let mut state = init(rules.clone(), [1; 32], host.clone()).unwrap();
        let mut log = Vec::new();
        record(&mut state, &mut log, &alice, Command::Join);
        record(&mut state, &mut log, &host, Command::Start);
        for _ in 0..=draw_offset {
            record(&mut state, &mut log, &host, Command::Draw);
        }
        record(
            &mut state,
            &mut log,
            &alice,
            Command::Mark {
                card_ix: 0,
                row,
                col,
            },
        );
        record(&mut state, &mut log, &alice, Command::Claim { card_ix: 0 });
        record(&mut state, &mut log, &host, Command::Close);
        (rules, state, log)
    }

    #[test]
    fn replay_accepts_claim_and_recognition_as_one_group() {
        let (rules, state, log) = claimed_game();
        assert_eq!(replay(&rules, [1; 32], &id("host"), &log).unwrap(), state);
    }

    #[test]
    fn replay_rejects_orphaned_and_truncated_recognition_events() {
        let (rules, _, log) = claimed_game();
        let recognition = log
            .iter()
            .find(|event| matches!(event, Event::WinRecognized { .. }))
            .unwrap()
            .clone();
        assert!(replay(&rules, [1; 32], &id("host"), &[recognition]).is_err());

        let claim_index = log
            .iter()
            .position(|event| matches!(event, Event::BingoClaimed { .. }))
            .unwrap();
        let truncated = &log[..=claim_index];
        assert!(replay(&rules, [1; 32], &id("host"), truncated).is_err());
    }

    #[test]
    fn replay_rejects_invalid_initial_rules_and_guarded_events() {
        let mut invalid = config(Daub::Auto);
        invalid.cards_per_player = 0;
        assert!(replay(&invalid, [1; 32], &id("host"), &[]).is_err());

        for patterns in [
            vec![0],
            vec![1u128 << BoardSize::S5.positions()],
            vec![1u128 << BoardSize::S5.center_index()],
        ] {
            let mut invalid = config(Daub::Auto);
            invalid.patterns = patterns;
            assert!(replay(&invalid, [1; 32], &id("host"), &[]).is_err());
        }

        let rules = config(Daub::Auto);
        let unauthorized = Event::GameStarted {
            seq: 0,
            actor: id("alice"),
        };
        assert!(replay(&rules, [1; 32], &id("host"), &[unauthorized]).is_err());
    }

    #[test]
    fn replay_reproduces_rejoins_and_a_backlog_redraw() {
        let seed = [1; 32];
        let host = id("host");
        let alice = id("alice");
        let bob = id("bob");
        let mut rules = config(Daub::Manual);
        rules.win_limit = WinLimit::Count(2);
        let order = crate::draw_order(seed, rules.size);
        let alice_card = generate_card(seed, &alice, 0, rules.size, rules.free_center);
        let bob_card = generate_card(seed, &bob, 0, rules.size, rules.free_center);
        let (alice_draw, alice_position) = alice_card
            .cells()
            .iter()
            .copied()
            .take(rules.size.positions())
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
        let (bob_draw, bob_position) = bob_card
            .cells()
            .iter()
            .copied()
            .take(rules.size.positions())
            .enumerate()
            .filter(|(position, number)| {
                *number != 0
                    && *position != alice_position
                    && order
                        .iter()
                        .position(|drawn| *drawn == *number)
                        .is_some_and(|draw| draw > alice_draw)
            })
            .map(|(position, number)| {
                (
                    order.iter().position(|drawn| *drawn == number).unwrap(),
                    position,
                )
            })
            .min()
            .unwrap();
        rules.patterns = vec![1u128 << alice_position, 1u128 << bob_position];
        let side = usize::from(rules.size.as_u8());
        let alice_mark = Command::Mark {
            card_ix: 0,
            row: alice_position / side,
            col: alice_position % side,
        };
        let bob_mark = Command::Mark {
            card_ix: 0,
            row: bob_position / side,
            col: bob_position % side,
        };

        let mut state = init(rules.clone(), seed, host.clone()).unwrap();
        let mut log = Vec::new();
        record(&mut state, &mut log, &alice, Command::Join);
        record(&mut state, &mut log, &host, Command::Start);
        for _ in 0..=alice_draw {
            record(&mut state, &mut log, &host, Command::Draw);
        }
        record(&mut state, &mut log, &alice, alice_mark.clone());
        record(&mut state, &mut log, &alice, Command::Leave);
        record(&mut state, &mut log, &alice, Command::Join);
        record(
            &mut state,
            &mut log,
            &alice,
            Command::Unmark {
                card_ix: 0,
                row: alice_position / side,
                col: alice_position % side,
            },
        );
        record(&mut state, &mut log, &alice, alice_mark);
        assert_eq!(state.wins().len(), 1);

        while state.draw_index <= bob_draw {
            record(&mut state, &mut log, &host, Command::Draw);
        }
        record(&mut state, &mut log, &bob, Command::Join);
        let before_rejected_mark = state.clone();
        assert_eq!(
            apply(&mut state, &bob, bob_mark.clone()),
            Err(RuleError::BacklogMarkNotAllowed)
        );
        assert_eq!(state, before_rejected_mark);
        record(&mut state, &mut log, &host, Command::Undo);
        record(&mut state, &mut log, &host, Command::Draw);
        record(&mut state, &mut log, &bob, bob_mark);

        assert_eq!(state.wins().len(), 2);
        assert_eq!(replay(&rules, seed, &host, &log).unwrap(), state);
    }

    #[test]
    fn state_and_events_survive_a_serde_round_trip() {
        let (_, state, log) = play_finished_game();
        let decoded_state: GameState =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(decoded_state, state);
        let decoded_log: Vec<Event> =
            serde_json::from_str(&serde_json::to_string(&log).unwrap()).unwrap();
        assert_eq!(decoded_log, log);
    }
}
