use core::fmt;
use serde::{Deserialize, Serialize};

/// Identity of a player within an issuer's namespace.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(try_from = "PlayerIdData")]
pub struct PlayerId {
    issuer: String,
    subject: String,
}

#[derive(Deserialize)]
struct PlayerIdData {
    issuer: String,
    subject: String,
}

/// Error returned when an identity field cannot be length-prefixed by the protocol.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PlayerIdError {
    IssuerTooLong,
    SubjectTooLong,
}

impl fmt::Display for PlayerIdError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::IssuerTooLong => "identity issuer exceeds the encoding limit",
            Self::SubjectTooLong => "identity subject exceeds the encoding limit",
        })
    }
}

impl PlayerIdData {
    fn try_into_with_limit(self, max_length: usize) -> Result<PlayerId, PlayerIdError> {
        PlayerId::new_with_limit(self.issuer, self.subject, max_length)
    }
}

impl TryFrom<PlayerIdData> for PlayerId {
    type Error = PlayerIdError;

    fn try_from(value: PlayerIdData) -> Result<Self, Self::Error> {
        value.try_into_with_limit(u32::MAX as usize)
    }
}

impl PlayerId {
    /// Creates an identity from opaque UTF-8 issuer and subject values.
    pub fn new(
        issuer: impl Into<String>,
        subject: impl Into<String>,
    ) -> Result<Self, PlayerIdError> {
        Self::new_with_limit(issuer, subject, u32::MAX as usize)
    }

    fn new_with_limit(
        issuer: impl Into<String>,
        subject: impl Into<String>,
        max_length: usize,
    ) -> Result<Self, PlayerIdError> {
        let issuer = issuer.into();
        let subject = subject.into();
        let max_length = max_length.min(u32::MAX as usize);
        if issuer.len() > max_length {
            return Err(PlayerIdError::IssuerTooLong);
        }
        if subject.len() > max_length {
            return Err(PlayerIdError::SubjectTooLong);
        }
        Ok(Self { issuer, subject })
    }

    /// Returns the identity issuer.
    pub fn issuer(&self) -> &str {
        &self.issuer
    }

    /// Returns the subject within the issuer's namespace.
    pub fn subject(&self) -> &str {
        &self.subject
    }

    pub(crate) fn issuer_len(&self) -> u32 {
        self.issuer.len() as u32
    }

    pub(crate) fn subject_len(&self) -> u32 {
        self.subject.len() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_fields_over_the_encoding_limit_are_rejected() {
        assert!(PlayerId::new_with_limit("long", "ok", 3).is_err());
        assert!(PlayerId::new_with_limit("ok", "long", 3).is_err());
        assert!(PlayerId::new_with_limit("yes", "yes", 3).is_ok());
    }

    #[test]
    fn serialized_identity_data_uses_the_validating_conversion() {
        assert_eq!(
            PlayerIdData {
                issuer: "long".to_owned(),
                subject: "ok".to_owned(),
            }
            .try_into_with_limit(3),
            Err(PlayerIdError::IssuerTooLong)
        );
        assert_eq!(
            PlayerIdData {
                issuer: "ok".to_owned(),
                subject: "long".to_owned(),
            }
            .try_into_with_limit(3),
            Err(PlayerIdError::SubjectTooLong)
        );
        let converted = PlayerId::try_from(PlayerIdData {
            issuer: "issuer".to_owned(),
            subject: "subject".to_owned(),
        })
        .unwrap();
        assert_eq!(converted, PlayerId::new("issuer", "subject").unwrap());
        let decoded: PlayerId =
            serde_json::from_str(r#"{"issuer":"issuer","subject":"subject"}"#).unwrap();
        assert_eq!(decoded, converted);
        assert!(!PlayerIdError::IssuerTooLong.to_string().is_empty());
        assert!(!PlayerIdError::SubjectTooLong.to_string().is_empty());
    }
}
