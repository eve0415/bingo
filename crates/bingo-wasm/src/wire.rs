use bingo_board::{BoardSize, Drawn};
use bingo_core::{
    CardView, Command, ConfigError, Daub, Event, GameConfig, HostView, LateJoin, Phase, PlayerId,
    PlayerIdError, PlayerView, RecognizedWin, RevokedMark, RuleError, WinDetection, WinLimit,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(transparent)]
#[ts(export, type = "string")]
/// An opaque serialized game snapshot. It is stored and returned verbatim because its contents include the unrevealed seed.
pub struct Snapshot(String);

impl Snapshot {
    pub(crate) fn new(value: String) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerIdDto {
    pub issuer: String,
    pub subject: String,
}

impl PlayerIdDto {
    pub(crate) fn into_core(self) -> Result<PlayerId, InputError> {
        create_player_id(self.issuer, self.subject, PlayerId::new)
    }
}

impl From<&PlayerId> for PlayerIdDto {
    fn from(value: &PlayerId) -> Self {
        Self {
            issuer: value.issuer().to_owned(),
            subject: value.subject().to_owned(),
        }
    }
}

fn create_player_id<F>(issuer: String, subject: String, create: F) -> Result<PlayerId, InputError>
where
    F: FnOnce(String, String) -> Result<PlayerId, PlayerIdError>,
{
    create(issuer, subject).map_err(|error| {
        InputError::new(match error {
            PlayerIdError::IssuerTooLong => "issuer exceeds the identity encoding limit",
            PlayerIdError::SubjectTooLong => "subject exceeds the identity encoding limit",
        })
    })
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum DaubDto {
    Auto,
    Manual,
}

impl From<DaubDto> for Daub {
    fn from(value: DaubDto) -> Self {
        match value {
            DaubDto::Auto => Self::Auto,
            DaubDto::Manual => Self::Manual,
        }
    }
}

impl From<Daub> for DaubDto {
    fn from(value: Daub) -> Self {
        match value {
            Daub::Auto => Self::Auto,
            Daub::Manual => Self::Manual,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum WinDetectionDto {
    Auto,
    Claim,
}

impl From<WinDetectionDto> for WinDetection {
    fn from(value: WinDetectionDto) -> Self {
        match value {
            WinDetectionDto::Auto => Self::Auto,
            WinDetectionDto::Claim => Self::Claim,
        }
    }
}

impl From<WinDetection> for WinDetectionDto {
    fn from(value: WinDetection) -> Self {
        match value {
            WinDetection::Auto => Self::Auto,
            WinDetection::Claim => Self::Claim,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum LateJoinDto {
    Closed,
    OpenNoBacklog,
    Open,
}

impl From<LateJoinDto> for LateJoin {
    fn from(value: LateJoinDto) -> Self {
        match value {
            LateJoinDto::Closed => Self::Closed,
            LateJoinDto::OpenNoBacklog => Self::OpenNoBacklog,
            LateJoinDto::Open => Self::Open,
        }
    }
}

impl From<LateJoin> for LateJoinDto {
    fn from(value: LateJoin) -> Self {
        match value {
            LateJoin::Closed => Self::Closed,
            LateJoin::OpenNoBacklog => Self::OpenNoBacklog,
            LateJoin::Open => Self::Open,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum WinLimitDto {
    FirstOnly,
    Count(u8),
    Unlimited,
}

impl From<WinLimitDto> for WinLimit {
    fn from(value: WinLimitDto) -> Self {
        match value {
            WinLimitDto::FirstOnly => Self::FirstOnly,
            WinLimitDto::Count(count) => Self::Count(count),
            WinLimitDto::Unlimited => Self::Unlimited,
        }
    }
}

impl From<WinLimit> for WinLimitDto {
    fn from(value: WinLimit) -> Self {
        match value {
            WinLimit::FirstOnly => Self::FirstOnly,
            WinLimit::Count(count) => Self::Count(count),
            WinLimit::Unlimited => Self::Unlimited,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConfigDto {
    pub size: u8,
    pub free_center: bool,
    pub patterns: Vec<Vec<usize>>,
    pub daub: DaubDto,
    pub win_detection: WinDetectionDto,
    pub late_join: LateJoinDto,
    pub win_limit: WinLimitDto,
    pub cards_per_player: u8,
}

impl ConfigDto {
    pub(crate) fn into_core(self) -> Result<GameConfig, InputError> {
        let Some(size) = BoardSize::from_u8(self.size) else {
            return Err(InputError::new("size must be one of 3, 5, 7, or 9"));
        };
        let patterns = self
            .patterns
            .into_iter()
            .map(|positions| positions_to_mask(positions, size))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(GameConfig {
            size,
            free_center: self.free_center,
            patterns,
            daub: self.daub.into(),
            win_detection: self.win_detection.into(),
            late_join: self.late_join.into(),
            win_limit: self.win_limit.into(),
            cards_per_player: self.cards_per_player,
        })
    }
}

impl From<&GameConfig> for ConfigDto {
    fn from(value: &GameConfig) -> Self {
        Self {
            size: value.size.as_u8(),
            free_center: value.free_center,
            patterns: masks_to_positions(&value.patterns, value.size),
            daub: value.daub.into(),
            win_detection: value.win_detection.into(),
            late_join: value.late_join.into(),
            win_limit: value.win_limit.into(),
            cards_per_player: value.cards_per_player,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all_fields = "camelCase")]
#[ts(export)]
pub enum CommandDto {
    Join,
    Leave,
    Mark { card_ix: u8, row: usize, col: usize },
    Unmark { card_ix: u8, row: usize, col: usize },
    Claim { card_ix: u8 },
    Start,
    Draw,
    Undo,
    Kick { target: PlayerIdDto },
    TransferHost { target: PlayerIdDto },
    Close,
}

impl CommandDto {
    pub(crate) fn into_core(self) -> Result<Command, InputError> {
        match self {
            Self::Join => Ok(Command::Join),
            Self::Leave => Ok(Command::Leave),
            Self::Mark { card_ix, row, col } => Ok(Command::Mark { card_ix, row, col }),
            Self::Unmark { card_ix, row, col } => Ok(Command::Unmark { card_ix, row, col }),
            Self::Claim { card_ix } => Ok(Command::Claim { card_ix }),
            Self::Start => Ok(Command::Start),
            Self::Draw => Ok(Command::Draw),
            Self::Undo => Ok(Command::Undo),
            Self::Kick { target } => target.into_core().map(|target| Command::Kick { target }),
            Self::TransferHost { target } => target
                .into_core()
                .map(|target| Command::TransferHost { target }),
            Self::Close => Ok(Command::Close),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RevokedMarkDto {
    pub player: PlayerIdDto,
    pub card_ix: u8,
    pub row: usize,
    pub col: usize,
}

impl RevokedMarkDto {
    fn into_core(self) -> Result<RevokedMark, InputError> {
        self.player.into_core().map(|player| RevokedMark {
            player,
            card_ix: self.card_ix,
            row: self.row,
            col: self.col,
        })
    }
}

impl From<&RevokedMark> for RevokedMarkDto {
    fn from(value: &RevokedMark) -> Self {
        Self {
            player: (&value.player).into(),
            card_ix: value.card_ix,
            row: value.row,
            col: value.col,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all_fields = "camelCase")]
#[ts(export)]
pub enum EventDto {
    PlayerJoined {
        #[ts(type = "number")]
        seq: u64,
        player: PlayerIdDto,
    },
    PlayerLeft {
        #[ts(type = "number")]
        seq: u64,
        player: PlayerIdDto,
    },
    MarkPlaced {
        #[ts(type = "number")]
        seq: u64,
        player: PlayerIdDto,
        card_ix: u8,
        row: usize,
        col: usize,
    },
    MarkRemoved {
        #[ts(type = "number")]
        seq: u64,
        player: PlayerIdDto,
        card_ix: u8,
        row: usize,
        col: usize,
    },
    BingoClaimed {
        #[ts(type = "number")]
        seq: u64,
        player: PlayerIdDto,
        card_ix: u8,
    },
    GameStarted {
        #[ts(type = "number")]
        seq: u64,
        actor: PlayerIdDto,
    },
    NumberDrawn {
        #[ts(type = "number")]
        seq: u64,
        actor: PlayerIdDto,
        number: u8,
    },
    DrawUndone {
        #[ts(type = "number")]
        seq: u64,
        actor: PlayerIdDto,
        number: u8,
        revoked: Vec<RevokedMarkDto>,
    },
    PlayerKicked {
        #[ts(type = "number")]
        seq: u64,
        actor: PlayerIdDto,
        target: PlayerIdDto,
    },
    HostTransferred {
        #[ts(type = "number")]
        seq: u64,
        actor: PlayerIdDto,
        target: PlayerIdDto,
    },
    GameClosed {
        #[ts(type = "number")]
        seq: u64,
        actor: PlayerIdDto,
    },
    WinRecognized {
        #[ts(type = "number")]
        seq: u64,
        winners: Vec<PlayerIdDto>,
        patterns: Vec<Vec<usize>>,
        #[ts(type = "number")]
        at_seq: u64,
        rank: u32,
    },
}

impl EventDto {
    pub(crate) fn into_core(self, size: BoardSize) -> Result<Event, InputError> {
        match self {
            Self::PlayerJoined { seq, player } => player
                .into_core()
                .map(|player| Event::PlayerJoined { seq, player }),
            Self::PlayerLeft { seq, player } => player
                .into_core()
                .map(|player| Event::PlayerLeft { seq, player }),
            Self::MarkPlaced {
                seq,
                player,
                card_ix,
                row,
                col,
            } => player.into_core().map(|player| Event::MarkPlaced {
                seq,
                player,
                card_ix,
                row,
                col,
            }),
            Self::MarkRemoved {
                seq,
                player,
                card_ix,
                row,
                col,
            } => player.into_core().map(|player| Event::MarkRemoved {
                seq,
                player,
                card_ix,
                row,
                col,
            }),
            Self::BingoClaimed {
                seq,
                player,
                card_ix,
            } => player.into_core().map(|player| Event::BingoClaimed {
                seq,
                player,
                card_ix,
            }),
            Self::GameStarted { seq, actor } => actor
                .into_core()
                .map(|actor| Event::GameStarted { seq, actor }),
            Self::NumberDrawn { seq, actor, number } => actor
                .into_core()
                .map(|actor| Event::NumberDrawn { seq, actor, number }),
            Self::DrawUndone {
                seq,
                actor,
                number,
                revoked,
            } => actor.into_core().and_then(|actor| {
                revoked
                    .into_iter()
                    .map(RevokedMarkDto::into_core)
                    .collect::<Result<Vec<_>, _>>()
                    .map(|revoked| Event::DrawUndone {
                        seq,
                        actor,
                        number,
                        revoked,
                    })
            }),
            Self::PlayerKicked { seq, actor, target } => actor.into_core().and_then(|actor| {
                target
                    .into_core()
                    .map(|target| Event::PlayerKicked { seq, actor, target })
            }),
            Self::HostTransferred { seq, actor, target } => actor.into_core().and_then(|actor| {
                target
                    .into_core()
                    .map(|target| Event::HostTransferred { seq, actor, target })
            }),
            Self::GameClosed { seq, actor } => actor
                .into_core()
                .map(|actor| Event::GameClosed { seq, actor }),
            Self::WinRecognized {
                seq,
                winners,
                patterns,
                at_seq,
                rank,
            } => winners
                .into_iter()
                .map(PlayerIdDto::into_core)
                .collect::<Result<Vec<_>, _>>()
                .and_then(|winners| {
                    patterns
                        .into_iter()
                        .map(|positions| positions_to_mask(positions, size))
                        .collect::<Result<Vec<_>, _>>()
                        .map(|patterns| Event::WinRecognized {
                            seq,
                            winners,
                            patterns,
                            at_seq,
                            rank,
                        })
                }),
        }
    }

    pub(crate) fn from_core(value: &Event, size: BoardSize) -> Self {
        match value {
            Event::PlayerJoined { seq, player } => Self::PlayerJoined {
                seq: *seq,
                player: player.into(),
            },
            Event::PlayerLeft { seq, player } => Self::PlayerLeft {
                seq: *seq,
                player: player.into(),
            },
            Event::MarkPlaced {
                seq,
                player,
                card_ix,
                row,
                col,
            } => Self::MarkPlaced {
                seq: *seq,
                player: player.into(),
                card_ix: *card_ix,
                row: *row,
                col: *col,
            },
            Event::MarkRemoved {
                seq,
                player,
                card_ix,
                row,
                col,
            } => Self::MarkRemoved {
                seq: *seq,
                player: player.into(),
                card_ix: *card_ix,
                row: *row,
                col: *col,
            },
            Event::BingoClaimed {
                seq,
                player,
                card_ix,
            } => Self::BingoClaimed {
                seq: *seq,
                player: player.into(),
                card_ix: *card_ix,
            },
            Event::GameStarted { seq, actor } => Self::GameStarted {
                seq: *seq,
                actor: actor.into(),
            },
            Event::NumberDrawn { seq, actor, number } => Self::NumberDrawn {
                seq: *seq,
                actor: actor.into(),
                number: *number,
            },
            Event::DrawUndone {
                seq,
                actor,
                number,
                revoked,
            } => Self::DrawUndone {
                seq: *seq,
                actor: actor.into(),
                number: *number,
                revoked: revoked.iter().map(RevokedMarkDto::from).collect(),
            },
            Event::PlayerKicked { seq, actor, target } => Self::PlayerKicked {
                seq: *seq,
                actor: actor.into(),
                target: target.into(),
            },
            Event::HostTransferred { seq, actor, target } => Self::HostTransferred {
                seq: *seq,
                actor: actor.into(),
                target: target.into(),
            },
            Event::GameClosed { seq, actor } => Self::GameClosed {
                seq: *seq,
                actor: actor.into(),
            },
            Event::WinRecognized {
                seq,
                winners,
                patterns,
                at_seq,
                rank,
            } => Self::WinRecognized {
                seq: *seq,
                winners: winners.iter().map(PlayerIdDto::from).collect(),
                patterns: masks_to_positions(patterns, size),
                at_seq: *at_seq,
                rank: *rank,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum PhaseDto {
    Lobby,
    Running,
    Finished,
}

impl From<Phase> for PhaseDto {
    fn from(value: Phase) -> Self {
        match value {
            Phase::Lobby => Self::Lobby,
            Phase::Running => Self::Running,
            Phase::Finished => Self::Finished,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecognizedWinDto {
    pub winners: Vec<PlayerIdDto>,
    pub patterns: Vec<Vec<usize>>,
    #[ts(type = "number")]
    pub at_seq: u64,
    pub rank: u32,
}

impl RecognizedWinDto {
    fn from_core(value: &RecognizedWin, size: BoardSize) -> Self {
        Self {
            winners: value.winners.iter().map(PlayerIdDto::from).collect(),
            patterns: masks_to_positions(&value.patterns, size),
            at_seq: value.at_seq,
            rank: value.rank,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CardViewDto {
    pub owner: PlayerIdDto,
    pub card_ix: u8,
    pub cells: Vec<u8>,
    pub marked: Vec<usize>,
    pub bingo: Vec<Vec<usize>>,
    pub reach: Vec<Vec<usize>>,
}

impl From<&CardView> for CardViewDto {
    fn from(value: &CardView) -> Self {
        Self {
            owner: (&value.owner).into(),
            card_ix: value.card_ix,
            cells: value.cells.clone(),
            marked: mask_to_positions(value.marks.bits(), value.marks.size()),
            bingo: masks_to_positions(&value.bingo, value.marks.size()),
            reach: masks_to_positions(&value.reach, value.marks.size()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerViewDto {
    pub config: ConfigDto,
    pub phase: PhaseDto,
    pub host: PlayerIdDto,
    pub players: Vec<PlayerIdDto>,
    pub drawn: Vec<u8>,
    pub wins: Vec<RecognizedWinDto>,
    pub cards: Vec<CardViewDto>,
    pub revealed_seed: Option<String>,
}

impl From<PlayerView> for PlayerViewDto {
    fn from(value: PlayerView) -> Self {
        let size = value.config.size;
        Self {
            config: (&value.config).into(),
            phase: value.phase.into(),
            host: (&value.host).into(),
            players: value.players.iter().map(PlayerIdDto::from).collect(),
            drawn: drawn_to_numbers(value.drawn, size),
            wins: value
                .wins
                .iter()
                .map(|win| RecognizedWinDto::from_core(win, size))
                .collect(),
            cards: value.cards.iter().map(CardViewDto::from).collect(),
            revealed_seed: value.revealed_seed.map(bytes_to_hex),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HostViewDto {
    pub config: ConfigDto,
    pub phase: PhaseDto,
    pub host: PlayerIdDto,
    pub players: Vec<PlayerIdDto>,
    pub drawn: Vec<u8>,
    pub wins: Vec<RecognizedWinDto>,
    pub cards: Vec<CardViewDto>,
    pub revealed_seed: Option<String>,
}

impl From<HostView> for HostViewDto {
    fn from(value: HostView) -> Self {
        let size = value.config.size;
        Self {
            config: (&value.config).into(),
            phase: value.phase.into(),
            host: (&value.host).into(),
            players: value.players.iter().map(PlayerIdDto::from).collect(),
            drawn: drawn_to_numbers(value.drawn, size),
            wins: value
                .wins
                .iter()
                .map(|win| RecognizedWinDto::from_core(win, size))
                .collect(),
            cards: value.cards.iter().map(CardViewDto::from).collect(),
            revealed_seed: value.revealed_seed.map(bytes_to_hex),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InitRequestDto {
    pub config: ConfigDto,
    pub seed: String,
    pub host: PlayerIdDto,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReplayRequestDto {
    pub config: ConfigDto,
    pub seed: String,
    pub host: PlayerIdDto,
    pub log: Vec<EventDto>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitmentRequestDto {
    pub seed: String,
    pub config: ConfigDto,
    /// Decoded straight into the engine's identity type, which validates as it deserializes.
    #[ts(as = "Vec<PlayerIdDto>")]
    pub roster: Vec<PlayerId>,
    pub room_id: String,
    pub game_index: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InitOkDto {
    pub state: Snapshot,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ApplyOkDto {
    pub state: Snapshot,
    pub events: Vec<EventDto>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitmentOkDto {
    pub commitment: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerProjectionOkDto {
    pub view: PlayerViewDto,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HostProjectionOkDto {
    pub view: HostViewDto,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum RuleErrorCodeDto {
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

impl From<RuleError> for RuleErrorCodeDto {
    fn from(value: RuleError) -> Self {
        match value {
            RuleError::NotHost => Self::NotHost,
            RuleError::WrongPhase => Self::WrongPhase,
            RuleError::NotAParticipant => Self::NotAParticipant,
            RuleError::RoomLocked => Self::RoomLocked,
            RuleError::UnknownCard => Self::UnknownCard,
            RuleError::NumberNotDrawn => Self::NumberNotDrawn,
            RuleError::BacklogMarkNotAllowed => Self::BacklogMarkNotAllowed,
            RuleError::NumberNotOnCard => Self::NumberNotOnCard,
            RuleError::NoSuchPosition => Self::NoSuchPosition,
            RuleError::NothingToUndo => Self::NothingToUndo,
            RuleError::WinAlreadyRecognised => Self::WinAlreadyRecognised,
            RuleError::NoBingo => Self::NoBingo,
            RuleError::ManualDaubDisabled => Self::ManualDaubDisabled,
            RuleError::ClaimDisabled => Self::ClaimDisabled,
            RuleError::NoNumbersRemain => Self::NoNumbersRemain,
            RuleError::NoSequenceRemain => Self::NoSequenceRemain,
            RuleError::LogMismatch => Self::LogMismatch,
            RuleError::Kicked => Self::Kicked,
            RuleError::AlreadyJoined => Self::AlreadyJoined,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[ts(export)]
pub enum ConfigErrorCodeDto {
    NoCards,
    EmptyPattern,
    PatternOutsideBoard,
    PatternAlreadyComplete,
}

impl From<ConfigError> for ConfigErrorCodeDto {
    fn from(value: ConfigError) -> Self {
        match value {
            ConfigError::NoCards => Self::NoCards,
            ConfigError::EmptyPattern => Self::EmptyPattern,
            ConfigError::PatternOutsideBoard => Self::PatternOutsideBoard,
            ConfigError::PatternAlreadyComplete => Self::PatternAlreadyComplete,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum BridgeErrorDto {
    Rule { code: RuleErrorCodeDto },
    Config { code: ConfigErrorCodeDto },
    Input { message: String },
    State { message: String },
}

impl From<RuleError> for BridgeErrorDto {
    fn from(value: RuleError) -> Self {
        Self::Rule { code: value.into() }
    }
}

impl From<ConfigError> for BridgeErrorDto {
    fn from(value: ConfigError) -> Self {
        Self::Config { code: value.into() }
    }
}

impl From<InputError> for BridgeErrorDto {
    fn from(value: InputError) -> Self {
        Self::Input {
            message: value.message,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Envelope<T> {
    Ok(T),
    Err(BridgeErrorDto),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InputError {
    message: String,
}

impl InputError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

pub(crate) fn seed_from_hex(value: &str) -> Result<[u8; 32], InputError> {
    if value.len() != 64 {
        return Err(InputError::new(
            "seed must be exactly 64 hexadecimal characters",
        ));
    }
    let mut nibbles = value.bytes().map(hex_nibble);
    let mut seed = [0u8; 32];
    for byte in &mut seed {
        let Some(high) = nibbles.next().flatten() else {
            return Err(InputError::new(
                "seed must be exactly 64 hexadecimal characters",
            ));
        };
        let Some(low) = nibbles.next().flatten() else {
            return Err(InputError::new(
                "seed must be exactly 64 hexadecimal characters",
            ));
        };
        *byte = (high << 4) | low;
    }
    Ok(seed)
}

fn hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

pub(crate) fn bytes_to_hex(value: [u8; 32]) -> String {
    value
        .into_iter()
        .flat_map(|byte| {
            let high = char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0');
            let low = char::from_digit(u32::from(byte & 0x0f), 16).unwrap_or('0');
            [high, low]
        })
        .collect()
}

fn positions_to_mask(positions: Vec<usize>, size: BoardSize) -> Result<u128, InputError> {
    let mut mask = 0u128;
    for position in positions {
        if position >= size.positions() {
            return Err(InputError::new(format!(
                "pattern cell index {position} is outside a {}x{} board",
                size.as_u8(),
                size.as_u8()
            )));
        }
        mask |= 1u128 << position;
    }
    Ok(mask)
}

fn mask_to_positions(mask: u128, size: BoardSize) -> Vec<usize> {
    (0..size.positions())
        .filter(|position| mask & (1u128 << position) != 0)
        .collect()
}

fn masks_to_positions(masks: &[u128], size: BoardSize) -> Vec<Vec<usize>> {
    masks
        .iter()
        .copied()
        .map(|mask| mask_to_positions(mask, size))
        .collect()
}

fn drawn_to_numbers(drawn: Drawn, size: BoardSize) -> Vec<u8> {
    (1..=size.max_number())
        .filter(|number| drawn.contains(*number))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_constructor_errors_are_input_errors() {
        for error in [PlayerIdError::IssuerTooLong, PlayerIdError::SubjectTooLong] {
            let result =
                create_player_id("issuer".to_owned(), "subject".to_owned(), |_, _| Err(error));
            assert!(result.is_err());
        }
    }

    #[test]
    fn hex_accepts_both_cases_and_rejects_every_invalid_shape() {
        assert_eq!(seed_from_hex(&"aB".repeat(32)).unwrap(), [0xab; 32]);
        assert!(seed_from_hex("00").is_err());
        assert!(seed_from_hex(&format!("{}g0", "00".repeat(31))).is_err());
        assert!(seed_from_hex(&format!("0g{}", "00".repeat(31))).is_err());
        assert_eq!(bytes_to_hex([0xab; 32]), "ab".repeat(32));
    }

    #[test]
    fn every_plain_enum_conversion_round_trips() {
        for value in [DaubDto::Auto, DaubDto::Manual] {
            assert_eq!(DaubDto::from(Daub::from(value)), value);
        }
        for value in [WinDetectionDto::Auto, WinDetectionDto::Claim] {
            assert_eq!(WinDetectionDto::from(WinDetection::from(value)), value);
        }
        for value in [
            LateJoinDto::Closed,
            LateJoinDto::OpenNoBacklog,
            LateJoinDto::Open,
        ] {
            assert_eq!(LateJoinDto::from(LateJoin::from(value)), value);
        }
        for value in [
            WinLimitDto::FirstOnly,
            WinLimitDto::Count(2),
            WinLimitDto::Unlimited,
        ] {
            assert_eq!(WinLimitDto::from(WinLimit::from(value)), value);
        }
        for (core, dto) in [
            (Phase::Lobby, PhaseDto::Lobby),
            (Phase::Running, PhaseDto::Running),
            (Phase::Finished, PhaseDto::Finished),
        ] {
            assert_eq!(PhaseDto::from(core), dto);
        }
    }

    #[test]
    fn masks_and_drawn_sets_expand_in_ascending_order() {
        assert_eq!(
            positions_to_mask(vec![8, 0, 4, 4], BoardSize::S3).unwrap(),
            0x111
        );
        assert_eq!(mask_to_positions(0x111, BoardSize::S3), vec![0, 4, 8]);
        assert!(positions_to_mask(vec![9], BoardSize::S3).is_err());

        let mut drawn = Drawn::default();
        drawn.insert(45);
        drawn.insert(1);
        drawn.insert(46);
        assert_eq!(drawn_to_numbers(drawn, BoardSize::S3), vec![1, 45]);
    }

    #[test]
    fn all_error_codes_convert() {
        for error in RuleError::all() {
            let code = RuleErrorCodeDto::from(error.clone());
            assert!(!serde_json::to_string(&code).unwrap().is_empty());
        }
        for error in [
            ConfigError::NoCards,
            ConfigError::EmptyPattern,
            ConfigError::PatternOutsideBoard,
            ConfigError::PatternAlreadyComplete,
        ] {
            let code = ConfigErrorCodeDto::from(error);
            assert!(!serde_json::to_string(&code).unwrap().is_empty());
        }
    }
}
