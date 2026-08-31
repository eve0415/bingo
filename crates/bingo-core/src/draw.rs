use crate::BoardSize;
use crate::derive::derive_draw_seed;
use crate::rng::bounded;
use core::num::NonZeroU32;
use rand_chacha::ChaCha8Rng;
use rand_core::SeedableRng;

/// Generates the deterministic permutation of numbers for a game.
pub fn draw_order(seed: [u8; 32], size: BoardSize) -> Vec<u8> {
    let mut order: Vec<u8> = (1..=size.max_number()).collect();
    let mut rng = ChaCha8Rng::from_seed(derive_draw_seed(seed, size));
    for index in (1..order.len()).rev() {
        let span = NonZeroU32::new((index + 1) as u32).unwrap_or(NonZeroU32::MIN);
        let other = bounded(&mut rng, span) as usize;
        order.swap(index, other);
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlayerId, generate_card};

    const EXPECTED_DRAW_3: &[u8] = &[
        39, 38, 13, 19, 22, 6, 37, 33, 30, 2, 15, 3, 10, 43, 25, 18, 36, 16, 12, 41, 44, 29, 28, 9,
        17, 40, 1, 5, 23, 34, 21, 27, 24, 4, 42, 35, 20, 45, 11, 31, 7, 32, 26, 14, 8,
    ];
    const EXPECTED_DRAW_5: &[u8] = &[
        48, 21, 35, 40, 16, 25, 75, 4, 22, 33, 49, 66, 62, 26, 55, 53, 1, 42, 37, 12, 28, 19, 61,
        69, 23, 13, 47, 32, 58, 27, 73, 70, 54, 34, 30, 41, 29, 6, 63, 14, 68, 31, 7, 50, 74, 72,
        45, 56, 65, 43, 57, 10, 52, 8, 59, 17, 46, 36, 9, 24, 60, 38, 18, 11, 64, 67, 15, 39, 20,
        51, 2, 71, 3, 5, 44,
    ];
    const EXPECTED_DRAW_7: &[u8] = &[
        105, 54, 55, 31, 6, 20, 1, 38, 15, 21, 53, 96, 29, 98, 43, 9, 63, 18, 40, 68, 94, 93, 17,
        48, 73, 25, 34, 52, 13, 71, 67, 57, 66, 24, 90, 35, 62, 72, 74, 4, 5, 10, 87, 85, 32, 104,
        69, 102, 19, 28, 83, 86, 49, 2, 84, 76, 75, 8, 27, 99, 30, 101, 7, 47, 16, 79, 11, 14, 70,
        51, 81, 12, 64, 3, 23, 50, 39, 82, 58, 103, 37, 42, 45, 77, 60, 91, 95, 100, 65, 92, 88,
        56, 61, 22, 46, 26, 78, 44, 41, 36, 33, 59, 80, 97, 89,
    ];
    const EXPECTED_DRAW_9: &[u8] = &[
        43, 83, 66, 1, 16, 3, 117, 36, 73, 129, 12, 51, 135, 13, 42, 33, 78, 115, 107, 34, 133,
        120, 99, 31, 26, 23, 6, 29, 49, 122, 70, 40, 15, 106, 103, 21, 77, 5, 93, 109, 59, 75, 58,
        64, 32, 119, 62, 2, 111, 74, 131, 11, 118, 50, 90, 68, 20, 87, 125, 39, 128, 72, 113, 54,
        102, 92, 96, 17, 95, 52, 88, 110, 132, 123, 85, 114, 134, 104, 71, 25, 14, 101, 7, 100, 91,
        10, 67, 80, 53, 28, 79, 35, 89, 9, 48, 84, 57, 105, 76, 60, 82, 63, 4, 69, 56, 130, 27, 30,
        86, 55, 94, 108, 112, 18, 19, 37, 65, 116, 61, 121, 126, 81, 38, 24, 97, 8, 46, 124, 44,
        127, 98, 47, 22, 41, 45,
    ];

    #[test]
    fn draw_order_is_a_permutation_of_every_number() {
        for size in [BoardSize::S3, BoardSize::S5, BoardSize::S7, BoardSize::S9] {
            let order = draw_order([4u8; 32], size);
            let mut sorted = order.clone();
            sorted.sort_unstable();
            let expected: Vec<u8> = (1..=size.max_number()).collect();
            assert_eq!(sorted, expected);
        }
    }

    #[test]
    fn draw_order_does_not_move_when_cards_are_generated() {
        let before = draw_order([4u8; 32], BoardSize::S5);
        let _ = generate_card(
            [4u8; 32],
            &PlayerId::new("i", "u").unwrap(),
            0,
            BoardSize::S5,
            true,
        );
        assert_eq!(before, draw_order([4u8; 32], BoardSize::S5));
    }

    #[test]
    fn golden_draw_order() {
        assert_eq!(draw_order([4u8; 32], BoardSize::S3), EXPECTED_DRAW_3);
        assert_eq!(draw_order([4u8; 32], BoardSize::S5), EXPECTED_DRAW_5);
        assert_eq!(draw_order([4u8; 32], BoardSize::S7), EXPECTED_DRAW_7);
        assert_eq!(draw_order([4u8; 32], BoardSize::S9), EXPECTED_DRAW_9);
    }
}
