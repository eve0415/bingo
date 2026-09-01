use super::*;
use crate::wire::{ConfigDto, DaubDto, EventDto, LateJoinDto, WinDetectionDto, WinLimitDto};
use serde::Serializer;
use serde::ser::Error as _;
use serde_json::{Value, json};

fn id(subject: &str) -> Value {
    json!({ "issuer": "issuer", "subject": subject })
}

fn config() -> Value {
    json!({
        "size": 3,
        "freeCenter": true,
        "patterns": [],
        "daub": "Auto",
        "winDetection": "Auto",
        "lateJoin": "Open",
        "winLimit": "Unlimited",
        "cardsPerPlayer": 1
    })
}

fn request_with_config(config: Value) -> String {
    json!({
        "config": config,
        "seed": "01".repeat(32),
        "host": id("host")
    })
    .to_string()
}

fn commitment_request(roster: Vec<Value>, room_id: &str, game_index: u32) -> String {
    json!({
        "seed": "02".repeat(32),
        "config": {
            "size": 3,
            "freeCenter": true,
            "patterns": [[0, 4, 8], [2, 4, 6]],
            "daub": "Manual",
            "winDetection": "Claim",
            "lateJoin": "OpenNoBacklog",
            "winLimit": { "Count": 2 },
            "cardsPerPlayer": 2
        },
        "roster": roster,
        "roomId": room_id,
        "gameIndex": game_index
    })
    .to_string()
}

fn commitment_value(request: String) -> Value {
    serde_json::from_str(&commitment(request)).unwrap()
}

fn initialized_state() -> String {
    ok_state(&init(request_with_config(config())))
}

fn ok_state(response: &str) -> String {
    serde_json::from_str::<Value>(response).unwrap()["ok"]["state"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn apply_command(state: &str, actor: &str, command: Value) -> Value {
    serde_json::from_str(&apply(
        state.to_owned(),
        id(actor).to_string(),
        command.to_string(),
    ))
    .unwrap()
}

#[test]
fn exports_delegate_a_complete_game_and_keep_the_seed_out_of_running_views() {
    let state = initialized_state();
    let joined = apply_command(&state, "alice", json!("Join"));
    assert_eq!(joined["ok"]["events"][0]["PlayerJoined"]["seq"], 0);
    let state = joined["ok"]["state"].as_str().unwrap().to_owned();

    let player: Value =
        serde_json::from_str(&project_player(state.clone(), id("alice").to_string())).unwrap();
    assert_eq!(player["ok"]["view"]["phase"], "Lobby");
    assert_eq!(player["ok"]["view"]["cards"].as_array().unwrap().len(), 1);
    assert_eq!(player["ok"]["view"]["cards"][0]["marked"], json!([4]));
    assert!(player["ok"]["view"]["revealedSeed"].is_null());
    assert!(player["ok"]["view"].get("seed").is_none());
    assert!(player["ok"]["view"].get("seedCommitment").is_none());

    let started = apply_command(&state, "host", json!("Start"));
    let state = started["ok"]["state"].as_str().unwrap().to_owned();
    let drawn = apply_command(&state, "host", json!("Draw"));
    let state = drawn["ok"]["state"].as_str().unwrap().to_owned();
    let host: Value = serde_json::from_str(&project_host(state.clone())).unwrap();
    assert_eq!(host["ok"]["view"]["phase"], "Running");
    assert_eq!(host["ok"]["view"]["drawn"].as_array().unwrap().len(), 1);
    assert!(host["ok"]["view"].get("seed").is_none());

    let closed = apply_command(&state, "host", json!("Close"));
    let state = closed["ok"]["state"].as_str().unwrap().to_owned();
    let host: Value = serde_json::from_str(&project_host(state)).unwrap();
    assert_eq!(host["ok"]["view"]["phase"], "Finished");
    assert_eq!(host["ok"]["view"]["revealedSeed"], "01".repeat(32));
}

#[test]
fn init_reports_input_and_config_errors() {
    let malformed: Value = serde_json::from_str(&init("{".to_owned())).unwrap();
    assert_eq!(malformed["err"]["type"], "input");

    let mut bad_size = config();
    bad_size["size"] = json!(4);
    let response: Value = serde_json::from_str(&init(request_with_config(bad_size))).unwrap();
    assert_eq!(response["err"]["type"], "input");

    let mut outside = config();
    outside["patterns"] = json!([[9]]);
    let response: Value = serde_json::from_str(&init(request_with_config(outside))).unwrap();
    assert_eq!(response["err"]["type"], "input");

    let mut no_cards = config();
    no_cards["cardsPerPlayer"] = json!(0);
    let response: Value = serde_json::from_str(&init(request_with_config(no_cards))).unwrap();
    assert_eq!(
        response,
        json!({ "err": { "type": "config", "code": "NoCards" } })
    );

    for seed in ["00".to_owned(), format!("{}xz", "00".repeat(31))] {
        let response: Value = serde_json::from_str(&init(
            json!({ "config": config(), "seed": seed, "host": id("host") }).to_string(),
        ))
        .unwrap();
        assert_eq!(response["err"]["type"], "input");
    }
}

#[test]
fn commitment_has_a_stable_golden_digest() {
    let response = commitment_value(commitment_request(
        vec![
            id("alice"),
            json!({ "issuer": "joincode", "subject": "bob" }),
        ],
        "room-123",
        42,
    ));
    assert_eq!(
        response,
        json!({
            "ok": {
                "commitment": "17398ec1cce8c646cefa38fb233344ca20969e723d267d9f4d6bea85647fe676"
            }
        })
    );
}

#[test]
fn commitment_canonicalizes_the_roster_and_binds_wrapper_context() {
    let alice = id("alice");
    let bob = json!({ "issuer": "joincode", "subject": "bob" });
    let base = commitment_value(commitment_request(
        vec![alice.clone(), bob.clone()],
        "room-123",
        42,
    ));
    let reversed = commitment_value(commitment_request(
        vec![bob.clone(), alice.clone()],
        "room-123",
        42,
    ));
    assert_eq!(base, reversed);
    assert_ne!(
        base,
        commitment_value(commitment_request(
            vec![alice.clone(), bob.clone()],
            "room-456",
            42,
        ))
    );
    assert_ne!(
        base,
        commitment_value(commitment_request(vec![alice, bob], "room-123", 43))
    );
}

#[test]
fn commitment_returns_input_envelopes_for_every_rejection() {
    let malformed = commitment_value("{".to_owned());
    assert_eq!(malformed["err"]["type"], "input");

    let mut bad_seed: Value =
        serde_json::from_str(&commitment_request(vec![], "room-123", 42)).unwrap();
    bad_seed["seed"] = json!("zz".repeat(32));
    let response = commitment_value(bad_seed.to_string());
    assert_eq!(
        response,
        json!({
            "err": {
                "type": "input",
                "message": "seed must be exactly 64 hexadecimal characters"
            }
        })
    );

    let malformed_identity = commitment_value(commitment_request(
        vec![json!({ "issuer": "issuer" })],
        "room-123",
        42,
    ));
    assert_eq!(malformed_identity["err"]["type"], "input");

    let mut bad_size: Value =
        serde_json::from_str(&commitment_request(vec![], "room-123", 42)).unwrap();
    bad_size["config"]["size"] = json!(4);
    let response = commitment_value(bad_size.to_string());
    assert_eq!(
        response,
        json!({
            "err": {
                "type": "input",
                "message": "size must be one of 3, 5, 7, or 9"
            }
        })
    );

    let mut outside: Value =
        serde_json::from_str(&commitment_request(vec![], "room-123", 42)).unwrap();
    outside["config"]["patterns"] = json!([[9]]);
    let response = commitment_value(outside.to_string());
    assert_eq!(
        response,
        json!({
            "err": {
                "type": "input",
                "message": "pattern cell index 9 is outside a 3x3 board"
            }
        })
    );

    let mut semantically_invalid: Value =
        serde_json::from_str(&commitment_request(vec![], "room-123", 42)).unwrap();
    semantically_invalid["config"]["cardsPerPlayer"] = json!(0);
    assert!(commitment_value(semantically_invalid.to_string())["ok"].is_object());
}

#[test]
fn apply_reports_each_argument_category_and_preserves_the_snapshot_on_rule_errors() {
    let corrupt: Value = serde_json::from_str(&apply(
        "{}".to_owned(),
        id("alice").to_string(),
        json!("Join").to_string(),
    ))
    .unwrap();
    assert_eq!(corrupt["err"]["type"], "state");

    let state = initialized_state();
    let bad_actor: Value = serde_json::from_str(&apply(
        state.clone(),
        "{".to_owned(),
        json!("Join").to_string(),
    ))
    .unwrap();
    assert_eq!(bad_actor["err"]["type"], "input");
    let bad_command: Value = serde_json::from_str(&apply(
        state.clone(),
        id("alice").to_string(),
        "{".to_owned(),
    ))
    .unwrap();
    assert_eq!(bad_command["err"]["type"], "input");

    let rejected = apply_command(&state, "alice", json!("Start"));
    assert_eq!(
        rejected,
        json!({ "err": { "type": "rule", "code": "NotHost" } })
    );
    let accepted = apply_command(&state, "alice", json!("Join"));
    assert_eq!(accepted["ok"]["events"][0]["PlayerJoined"]["seq"], 0);
}

#[test]
fn projection_exports_distinguish_state_and_identity_json() {
    let state_error: Value = serde_json::from_str(&project_player(
        "not-json".to_owned(),
        id("alice").to_string(),
    ))
    .unwrap();
    assert_eq!(state_error["err"]["type"], "state");

    let state = initialized_state();
    let who_error: Value =
        serde_json::from_str(&project_player(state.clone(), "{".to_owned())).unwrap();
    assert_eq!(who_error["err"]["type"], "input");

    let host_error: Value = serde_json::from_str(&project_host("[]".to_owned())).unwrap();
    assert_eq!(host_error["err"]["type"], "state");
}

#[test]
fn replay_accepts_wire_events_and_rejects_mismatches() {
    let joined = apply_command(&initialized_state(), "alice", json!("Join"));
    let log = joined["ok"]["events"].clone();
    let replayed: Value = serde_json::from_str(&replay(
        json!({
            "config": config(),
            "seed": "01".repeat(32),
            "host": id("host"),
            "log": log
        })
        .to_string(),
    ))
    .unwrap();
    assert!(replayed.get("ok").is_some());

    let mismatch: Value = serde_json::from_str(&replay(
        json!({
            "config": config(),
            "seed": "01".repeat(32),
            "host": id("host"),
            "log": [{ "PlayerJoined": { "seq": 7, "player": id("alice") } }]
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(
        mismatch,
        json!({ "err": { "type": "rule", "code": "LogMismatch" } })
    );

    let malformed: Value = serde_json::from_str(&replay("{".to_owned())).unwrap();
    assert_eq!(malformed["err"]["type"], "input");

    let mut bad_size = config();
    bad_size["size"] = json!(4);
    let invalid_config: Value = serde_json::from_str(&replay(
        json!({
            "config": bad_size,
            "seed": "01".repeat(32),
            "host": id("host"),
            "log": []
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(invalid_config["err"]["type"], "input");

    let invalid_seed: Value = serde_json::from_str(&replay(
        json!({
            "config": config(),
            "seed": "01",
            "host": id("host"),
            "log": []
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(invalid_seed["err"]["type"], "input");

    let outside: Value = serde_json::from_str(&replay(
        json!({
            "config": config(),
            "seed": "01".repeat(32),
            "host": id("host"),
            "log": [{
                "WinRecognized": {
                    "seq": 0,
                    "winners": [id("alice")],
                    "patterns": [[9]],
                    "atSeq": 0,
                    "rank": 1
                }
            }]
        })
        .to_string(),
    ))
    .unwrap();
    assert_eq!(outside["err"]["type"], "input");
}

#[test]
fn projections_expand_recognized_wins() {
    let joined = apply_command(&initialized_state(), "alice", json!("Join"));
    let state = joined["ok"]["state"].as_str().unwrap().to_owned();
    let started = apply_command(&state, "host", json!("Start"));
    let mut state = started["ok"]["state"].as_str().unwrap().to_owned();

    let mut recognized = false;
    for _ in 0..45 {
        let drawn = apply_command(&state, "host", json!("Draw"));
        recognized = drawn["ok"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|event| event.get("WinRecognized").is_some());
        state = drawn["ok"]["state"].as_str().unwrap().to_owned();
        if recognized {
            break;
        }
    }
    assert!(recognized);

    let player: Value =
        serde_json::from_str(&project_player(state.clone(), id("alice").to_string())).unwrap();
    let host: Value = serde_json::from_str(&project_host(state)).unwrap();
    for view in [&player["ok"]["view"], &host["ok"]["view"]] {
        assert_eq!(view["wins"].as_array().unwrap().len(), 1);
        assert!(!view["wins"][0]["patterns"].as_array().unwrap().is_empty());
    }
}

#[derive(Debug)]
struct FailingSerialize;

impl Serialize for FailingSerialize {
    fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        Err(S::Error::custom("deliberate serialization failure"))
    }
}

#[test]
fn serialization_failures_still_return_error_envelopes() {
    assert_eq!(
        snapshot_payload(&FailingSerialize, |snapshot| snapshot),
        Err(BridgeErrorDto::State {
            message: "snapshot could not be encoded: deliberate serialization failure".to_owned()
        })
    );
    assert_eq!(encode(Envelope::Ok(FailingSerialize)), ENCODING_FAILURE);
}

#[test]
fn snapshot_is_a_transparent_string() {
    let snapshot = Snapshot::new("opaque".to_owned());
    assert_eq!(serde_json::to_string(&snapshot).unwrap(), r#""opaque""#);
}

#[test]
fn config_dto_round_trips_every_field() {
    let dto = ConfigDto {
        size: 9,
        free_center: false,
        patterns: vec![vec![0, 80]],
        daub: DaubDto::Manual,
        win_detection: WinDetectionDto::Claim,
        late_join: LateJoinDto::Closed,
        win_limit: WinLimitDto::Count(3),
        cards_per_player: 2,
    };
    let core = dto.clone().into_core().unwrap();
    assert_eq!(ConfigDto::from(&core), dto);
}

#[test]
fn command_dto_converts_every_variant() {
    let target = crate::wire::PlayerIdDto {
        issuer: "issuer".to_owned(),
        subject: "target".to_owned(),
    };
    let commands = [
        CommandDto::Join,
        CommandDto::Leave,
        CommandDto::Mark {
            card_ix: 1,
            row: 2,
            col: 3,
        },
        CommandDto::Unmark {
            card_ix: 1,
            row: 2,
            col: 3,
        },
        CommandDto::Claim { card_ix: 1 },
        CommandDto::Start,
        CommandDto::Draw,
        CommandDto::Undo,
        CommandDto::Kick {
            target: target.clone(),
        },
        CommandDto::TransferHost { target },
        CommandDto::Close,
    ];
    for command in commands {
        assert!(command.into_core().is_ok());
    }
}

#[test]
fn event_dto_round_trips_every_variant() {
    let alice = crate::wire::PlayerIdDto {
        issuer: "issuer".to_owned(),
        subject: "alice".to_owned(),
    };
    let bob = crate::wire::PlayerIdDto {
        issuer: "issuer".to_owned(),
        subject: "bob".to_owned(),
    };
    let events = vec![
        EventDto::PlayerJoined {
            seq: 0,
            player: alice.clone(),
        },
        EventDto::PlayerLeft {
            seq: 1,
            player: alice.clone(),
        },
        EventDto::MarkPlaced {
            seq: 2,
            player: alice.clone(),
            card_ix: 0,
            row: 1,
            col: 2,
        },
        EventDto::MarkRemoved {
            seq: 3,
            player: alice.clone(),
            card_ix: 0,
            row: 1,
            col: 2,
        },
        EventDto::BingoClaimed {
            seq: 4,
            player: alice.clone(),
            card_ix: 0,
        },
        EventDto::GameStarted {
            seq: 5,
            actor: alice.clone(),
        },
        EventDto::NumberDrawn {
            seq: 6,
            actor: alice.clone(),
            number: 42,
        },
        EventDto::DrawUndone {
            seq: 7,
            actor: alice.clone(),
            number: 42,
            revoked: vec![crate::wire::RevokedMarkDto {
                player: bob.clone(),
                card_ix: 1,
                row: 2,
                col: 2,
            }],
        },
        EventDto::PlayerKicked {
            seq: 8,
            actor: alice.clone(),
            target: bob.clone(),
        },
        EventDto::HostTransferred {
            seq: 9,
            actor: alice.clone(),
            target: bob.clone(),
        },
        EventDto::GameClosed {
            seq: 10,
            actor: alice.clone(),
        },
        EventDto::WinRecognized {
            seq: 11,
            winners: vec![alice],
            patterns: vec![vec![0, 4, 8]],
            at_seq: 10,
            rank: 1,
        },
    ];

    for event in events {
        let core = event.clone().into_core(bingo_core::BoardSize::S3).unwrap();
        assert_eq!(EventDto::from_core(&core, bingo_core::BoardSize::S3), event);
    }
}

#[test]
fn error_conversions_use_the_four_envelope_categories() {
    assert!(matches!(
        BridgeErrorDto::from(bingo_core::RuleError::WrongPhase),
        BridgeErrorDto::Rule { .. }
    ));
    assert!(matches!(
        BridgeErrorDto::from(bingo_core::ConfigError::EmptyPattern),
        BridgeErrorDto::Config { .. }
    ));
    assert!(matches!(
        BridgeErrorDto::from(crate::wire::InputError::new("bad")),
        BridgeErrorDto::Input { .. }
    ));
}
