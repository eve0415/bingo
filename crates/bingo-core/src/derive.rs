use crate::{BoardSize, Daub, GameConfig, LateJoin, PlayerId, WinDetection, WinLimit};
use hkdf::Hkdf;
use sha2::Sha256;

const HKDF_SALT: &[u8] = b"bingo/hkdf/v1";
const CARD_DOMAIN: &[u8] = b"bingo/card/v1";
const DRAW_DOMAIN: &[u8] = b"bingo/draw/v1";
const COMMIT_DOMAIN: &[u8] = b"bingo/commit/v1";

fn push_field(out: &mut Vec<u8>, length: u32, bytes: &[u8]) {
    out.extend_from_slice(&length.to_be_bytes());
    out.extend_from_slice(bytes);
}

pub(crate) fn card_info(id: &PlayerId, card_ix: u8, size: BoardSize, free_center: bool) -> Vec<u8> {
    let mut info = CARD_DOMAIN.to_vec();
    push_field(&mut info, id.issuer_len(), id.issuer().as_bytes());
    push_field(&mut info, id.subject_len(), id.subject().as_bytes());
    info.extend_from_slice(&u64::from(card_ix).to_be_bytes());
    info.push(size.as_u8());
    info.push(u8::from(free_center));
    info
}

fn expand(seed: [u8; 32], info: &[u8]) -> [u8; 32] {
    let hkdf = Hkdf::<Sha256>::new(Some(HKDF_SALT), &seed);
    let mut output = [0u8; 32];
    let _ = hkdf.expand(info, &mut output);
    output
}

pub(crate) fn derive_card_seed(
    seed: [u8; 32],
    id: &PlayerId,
    card_ix: u8,
    size: BoardSize,
    free_center: bool,
) -> [u8; 32] {
    expand(seed, &card_info(id, card_ix, size, free_center))
}

pub(crate) fn derive_draw_seed(seed: [u8; 32], size: BoardSize) -> [u8; 32] {
    let mut info = DRAW_DOMAIN.to_vec();
    info.push(size.as_u8());
    expand(seed, &info)
}

fn push_count(out: &mut Vec<u8>, count: usize) {
    out.extend_from_slice(&(count as u32).to_be_bytes());
}

/// Encodes the seed, game rules, and roster into a stable commitment prefix.
///
/// A caller can append wrapper-owned context before hashing the complete input.
pub fn commitment_input(seed: [u8; 32], config: &GameConfig, roster: &[PlayerId]) -> Vec<u8> {
    let mut out = COMMIT_DOMAIN.to_vec();
    out.extend_from_slice(&seed);
    out.push(config.size.as_u8());
    out.push(u8::from(config.free_center));

    let mut patterns = config.patterns.clone();
    patterns.sort_unstable();
    push_count(&mut out, patterns.len());
    for pattern in patterns {
        out.extend_from_slice(&pattern.to_be_bytes());
    }

    out.push(match config.daub {
        Daub::Auto => 0,
        Daub::Manual => 1,
    });
    out.push(match config.win_detection {
        WinDetection::Auto => 0,
        WinDetection::Claim => 1,
    });
    out.push(match config.late_join {
        LateJoin::Closed => 0,
        LateJoin::OpenNoBacklog => 1,
        LateJoin::Open => 2,
    });
    match config.win_limit {
        WinLimit::FirstOnly => out.extend_from_slice(&[0, 0]),
        WinLimit::Count(count) => out.extend_from_slice(&[1, count]),
        WinLimit::Unlimited => out.extend_from_slice(&[2, 0]),
    }
    out.push(config.cards_per_player);

    let mut roster: Vec<&PlayerId> = roster.iter().collect();
    roster.sort_unstable();
    push_count(&mut out, roster.len());
    for id in roster {
        push_field(&mut out, id.issuer_len(), id.issuer().as_bytes());
        push_field(&mut out, id.subject_len(), id.subject().as_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::base_config;

    const EXPECTED_CARD_SEED: [u8; 32] = [
        162, 227, 195, 162, 152, 148, 165, 54, 145, 101, 16, 179, 80, 234, 40, 177, 93, 209, 93,
        236, 37, 65, 154, 50, 44, 109, 223, 235, 180, 109, 203, 174,
    ];
    const EXPECTED_COMMITMENT_INPUT: &[u8] = &[
        98, 105, 110, 103, 111, 47, 99, 111, 109, 109, 105, 116, 47, 118, 49, 2, 2, 2, 2, 2, 2, 2,
        2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 5, 1, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 7, 100, 105, 115, 99, 111, 114, 100, 0, 0, 0, 5,
        97, 108, 105, 99, 101,
    ];

    #[test]
    fn length_prefixing_makes_the_encoding_injective() {
        let a = PlayerId::new("discord", "11111111111111111").unwrap();
        let b = PlayerId::new("discord", "111111111111111111").unwrap();
        assert_ne!(
            card_info(&a, 11, BoardSize::S5, true),
            card_info(&b, 1, BoardSize::S5, true)
        );
    }

    #[test]
    fn issuer_namespaces_the_subject() {
        let a = PlayerId::new("discord", "12345").unwrap();
        let b = PlayerId::new("joincode", "12345").unwrap();
        assert_ne!(
            card_info(&a, 0, BoardSize::S5, true),
            card_info(&b, 0, BoardSize::S5, true)
        );
    }

    #[test]
    fn card_and_draw_streams_are_independent() {
        let seed = [3u8; 32];
        let id = PlayerId::new("discord", "1").unwrap();
        assert_ne!(
            derive_card_seed(seed, &id, 0, BoardSize::S5, true),
            derive_draw_seed(seed, BoardSize::S5)
        );
    }

    #[test]
    fn golden_derived_seed() {
        let id = PlayerId::new("discord", "123456789012345678").unwrap();
        assert_eq!(
            derive_card_seed([1u8; 32], &id, 0, BoardSize::S5, true),
            EXPECTED_CARD_SEED
        );
    }

    fn alice() -> PlayerId {
        PlayerId::new("discord", "alice").unwrap()
    }

    fn bob() -> PlayerId {
        PlayerId::new("discord", "bob").unwrap()
    }

    fn carol() -> PlayerId {
        PlayerId::new("joincode", "carol").unwrap()
    }

    #[test]
    fn the_commitment_binds_the_config_and_the_roster() {
        let seed = [2u8; 32];
        let roster = vec![alice(), bob()];
        let base = commitment_input(seed, &base_config(), &roster);

        let mut changed = base_config();
        changed.patterns = vec![(1 << 0) | (1 << 4) | (1 << 20) | (1 << 24)];
        assert_ne!(base, commitment_input(seed, &changed, &roster));

        let mut bigger = roster.clone();
        bigger.push(carol());
        assert_ne!(base, commitment_input(seed, &base_config(), &bigger));
        assert_ne!(base, commitment_input([3u8; 32], &base_config(), &roster));
    }

    #[test]
    fn every_configuration_field_is_bound() {
        let base = commitment_input([2u8; 32], &base_config(), &[alice()]);
        let variants = [
            GameConfig {
                free_center: false,
                ..base_config()
            },
            GameConfig {
                daub: Daub::Manual,
                ..base_config()
            },
            GameConfig {
                win_detection: WinDetection::Claim,
                ..base_config()
            },
            GameConfig {
                late_join: LateJoin::OpenNoBacklog,
                ..base_config()
            },
            GameConfig {
                late_join: LateJoin::Open,
                ..base_config()
            },
            GameConfig {
                win_limit: WinLimit::Count(2),
                ..base_config()
            },
            GameConfig {
                win_limit: WinLimit::Unlimited,
                ..base_config()
            },
            GameConfig {
                cards_per_player: 2,
                ..base_config()
            },
        ];
        for variant in variants {
            assert_ne!(base, commitment_input([2u8; 32], &variant, &[alice()]));
        }
    }

    #[test]
    fn roster_and_pattern_order_do_not_change_the_commitment() {
        let seed = [2u8; 32];
        assert_eq!(
            commitment_input(seed, &base_config(), &[alice(), bob()]),
            commitment_input(seed, &base_config(), &[bob(), alice()])
        );

        let mut forward = base_config();
        forward.patterns = vec![1, 2];
        let mut reverse = base_config();
        reverse.patterns = vec![2, 1];
        assert_eq!(
            commitment_input(seed, &forward, &[alice()]),
            commitment_input(seed, &reverse, &[alice()])
        );
    }

    #[test]
    fn golden_commitment_input() {
        assert_eq!(
            commitment_input([2u8; 32], &base_config(), &[alice()]),
            EXPECTED_COMMITMENT_INPUT
        );
    }
}
