use crate::derive::derive_card_seed;
use crate::rng::bounded;
use crate::{BoardSize, Card, PlayerId};
use core::num::NonZeroU32;
use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

/// Generates a deterministic card for a player and card index.
pub fn generate_card(
    seed: [u8; 32],
    id: &PlayerId,
    card_ix: u8,
    size: BoardSize,
    free_center: bool,
) -> Card {
    let mut rng = ChaCha8Rng::from_seed(derive_card_seed(seed, id, card_ix, size, free_center));
    generate_card_with_rng(&mut rng, size, free_center)
}

pub(crate) fn generate_card_with_rng<R: RngCore>(
    rng: &mut R,
    size: BoardSize,
    free_center: bool,
) -> Card {
    let side = usize::from(size.as_u8());
    let middle = side / 2;
    let mut cells = [0u8; 81];

    for col in 0..side {
        let mut candidates = [0u8; 15];
        for (index, slot) in candidates.iter_mut().enumerate() {
            *slot = (col as u8) * 15 + 1 + index as u8;
        }

        let is_free_column = free_center && col == middle;
        let mut emitted = 0usize;
        for (row, cell) in cells
            .iter_mut()
            .take(side * side)
            .skip(col)
            .step_by(side)
            .enumerate()
        {
            if is_free_column && row == middle {
                continue;
            }
            let span = NonZeroU32::new((15 - emitted) as u32).unwrap_or(NonZeroU32::MIN);
            let offset = bounded(rng, span) as usize;
            candidates.swap(emitted, emitted + offset);
            *cell = candidates.get(emitted).copied().unwrap_or_default();
            emitted += 1;
        }
    }

    Card::from_cells(cells, size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_chacha::ChaCha8Rng;

    const EXPECTED_CARD_3_FULL: [u8; 81] = [
        4, 22, 41, 5, 27, 40, 2, 26, 35, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const EXPECTED_CARD_3_FREE: [u8; 81] = [
        2, 29, 33, 9, 0, 35, 5, 25, 43, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const EXPECTED_CARD_5_FULL: [u8; 81] = [
        13, 24, 31, 53, 70, 3, 29, 37, 58, 73, 7, 23, 38, 54, 74, 15, 18, 44, 50, 66, 6, 20, 42,
        49, 71, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const EXPECTED_CARD_5_FREE: [u8; 81] = [
        5, 24, 42, 60, 70, 7, 30, 44, 54, 73, 10, 20, 0, 55, 72, 1, 16, 34, 46, 68, 11, 22, 36, 48,
        75, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const EXPECTED_CARD_7_FULL: [u8; 81] = [
        4, 26, 43, 59, 61, 77, 95, 11, 30, 38, 57, 65, 83, 97, 8, 18, 36, 51, 74, 82, 93, 7, 16,
        35, 54, 69, 86, 96, 2, 19, 42, 56, 62, 78, 100, 3, 25, 32, 60, 63, 79, 101, 5, 22, 44, 52,
        66, 80, 94, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
    ];
    const EXPECTED_CARD_7_FREE: [u8; 81] = [
        14, 22, 36, 53, 67, 83, 98, 1, 18, 43, 50, 75, 82, 94, 9, 20, 40, 55, 61, 84, 95, 2, 21,
        34, 0, 66, 89, 102, 15, 26, 32, 58, 69, 78, 99, 5, 30, 37, 57, 64, 86, 97, 8, 24, 33, 48,
        65, 88, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0,
    ];
    const EXPECTED_CARD_9_FULL: [u8; 81] = [
        15, 25, 44, 55, 71, 81, 103, 112, 121, 2, 19, 34, 58, 63, 83, 97, 107, 124, 6, 20, 37, 47,
        73, 88, 96, 118, 129, 4, 22, 43, 59, 68, 84, 99, 109, 134, 14, 29, 39, 60, 65, 78, 104,
        116, 131, 9, 28, 41, 57, 67, 76, 92, 119, 127, 1, 27, 35, 52, 61, 82, 102, 108, 123, 13,
        23, 33, 46, 74, 86, 105, 117, 125, 11, 17, 45, 50, 66, 90, 100, 111, 130,
    ];
    const EXPECTED_CARD_9_FREE: [u8; 81] = [
        8, 28, 41, 46, 67, 80, 102, 117, 124, 6, 26, 37, 60, 73, 81, 96, 106, 132, 11, 23, 34, 53,
        68, 78, 97, 111, 130, 13, 20, 43, 47, 65, 88, 92, 118, 133, 7, 29, 45, 57, 0, 87, 99, 112,
        126, 3, 19, 38, 55, 63, 79, 91, 115, 128, 10, 22, 44, 48, 61, 85, 105, 108, 129, 15, 21,
        39, 56, 70, 84, 103, 109, 122, 9, 16, 35, 59, 66, 90, 100, 119, 123,
    ];

    #[test]
    fn every_column_draws_from_its_own_range_without_duplicates() {
        for size in [BoardSize::S3, BoardSize::S5, BoardSize::S7, BoardSize::S9] {
            let card = generate_card([9u8; 32], &PlayerId::new("i", "u").unwrap(), 0, size, true);
            let n = usize::from(size.as_u8());
            for col in 0..n {
                let lo = (col as u8) * 15 + 1;
                let hi = (col as u8 + 1) * 15;
                let mut seen = Vec::new();
                for row in 0..n {
                    let value = card.cell(row, col);
                    if value == 0 {
                        continue;
                    }
                    assert!(
                        (lo..=hi).contains(&value),
                        "size {n} col {col} value {value}"
                    );
                    assert!(!seen.contains(&value), "duplicate {value} in column {col}");
                    seen.push(value);
                }
            }
        }
    }

    #[test]
    fn free_center_is_present_only_when_configured() {
        let id = PlayerId::new("i", "u").unwrap();
        let free = generate_card([9u8; 32], &id, 0, BoardSize::S5, true);
        assert_eq!(free.cell(2, 2), 0);
        let full = generate_card([9u8; 32], &id, 0, BoardSize::S5, false);
        assert_ne!(full.cell(2, 2), 0);
    }

    #[test]
    fn the_free_cell_consumes_no_randomness() {
        let mut used = ChaCha8Rng::from_seed([9u8; 32]);
        let _ = generate_card_with_rng(&mut used, BoardSize::S5, true);
        let mut fresh = ChaCha8Rng::from_seed([9u8; 32]);
        for _ in 0..24 {
            let _ = fresh.next_u32();
        }
        assert_eq!(
            used.next_u32(),
            fresh.next_u32(),
            "a free-centre 5x5 consumes exactly 24 words"
        );
    }

    #[test]
    fn identity_and_card_index_both_change_the_card() {
        let seed = [9u8; 32];
        let a = generate_card(
            seed,
            &PlayerId::new("i", "alice").unwrap(),
            0,
            BoardSize::S5,
            true,
        );
        let b = generate_card(
            seed,
            &PlayerId::new("i", "bob").unwrap(),
            0,
            BoardSize::S5,
            true,
        );
        let c = generate_card(
            seed,
            &PlayerId::new("i", "alice").unwrap(),
            1,
            BoardSize::S5,
            true,
        );
        assert_ne!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn generation_is_stable_across_calls() {
        let id = PlayerId::new("i", "u").unwrap();
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S5, true),
            generate_card([9u8; 32], &id, 0, BoardSize::S5, true)
        );
    }

    #[test]
    fn golden_cards() {
        let id = PlayerId::new("i", "golden").unwrap();
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S3, false).cells(),
            &EXPECTED_CARD_3_FULL
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S3, true).cells(),
            &EXPECTED_CARD_3_FREE
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S5, false).cells(),
            &EXPECTED_CARD_5_FULL
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S5, true).cells(),
            &EXPECTED_CARD_5_FREE
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S7, false).cells(),
            &EXPECTED_CARD_7_FULL
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S7, true).cells(),
            &EXPECTED_CARD_7_FREE
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S9, false).cells(),
            &EXPECTED_CARD_9_FULL
        );
        assert_eq!(
            generate_card([9u8; 32], &id, 0, BoardSize::S9, true).cells(),
            &EXPECTED_CARD_9_FREE
        );
    }
}
