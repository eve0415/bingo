use crate::{BoardSize, Marks};

/// Builds every row, every column, and both diagonals for a board.
pub fn default_patterns(size: BoardSize) -> Vec<u128> {
    let side = usize::from(size.as_u8());
    let mut patterns = Vec::with_capacity(side * 2 + 2);

    for row in 0..side {
        let mut pattern = 0u128;
        for col in 0..side {
            pattern |= position_bit(side, row, col);
        }
        patterns.push(pattern);
    }

    for col in 0..side {
        let mut pattern = 0u128;
        for row in 0..side {
            pattern |= position_bit(side, row, col);
        }
        patterns.push(pattern);
    }

    let mut main_diagonal = 0u128;
    let mut other_diagonal = 0u128;
    for index in 0..side {
        main_diagonal |= position_bit(side, index, index);
        other_diagonal |= position_bit(side, index, side - 1 - index);
    }
    patterns.push(main_diagonal);
    patterns.push(other_diagonal);
    patterns
}

/// Creates the mark state at the start of play.
pub fn initial_marks(size: BoardSize, free_center: bool) -> Marks {
    let mut marks = Marks::new(size);
    if free_center {
        let middle = usize::from(size.as_u8()) / 2;
        let _ = marks.set(middle, middle);
    }
    marks
}

/// Builds a pattern containing the board's four corners.
pub fn four_corners(size: BoardSize) -> u128 {
    let side = usize::from(size.as_u8());
    position_bit(side, 0, 0)
        | position_bit(side, 0, side - 1)
        | position_bit(side, side - 1, 0)
        | position_bit(side, side - 1, side - 1)
}

/// Builds a pattern containing every active cell.
pub fn blackout(size: BoardSize) -> u128 {
    (1u128 << size.positions()) - 1
}

fn position_bit(side: usize, row: usize, col: usize) -> u128 {
    1u128 << (row * side + col)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BoardSize;

    #[test]
    fn default_patterns_are_rows_columns_and_both_diagonals() {
        assert_eq!(default_patterns(BoardSize::S5).len(), 12);
        assert_eq!(default_patterns(BoardSize::S3).len(), 8);
        for pattern in default_patterns(BoardSize::S5) {
            assert_eq!(pattern.count_ones(), 5);
        }
    }

    #[test]
    fn free_center_is_preseeded_into_marks() {
        let marks = initial_marks(BoardSize::S5, true);
        assert!(marks.get(2, 2));
        assert_eq!(initial_marks(BoardSize::S5, false).popcount(), 0);
    }

    #[test]
    fn a_centre_pattern_is_winnable_with_a_free_centre() {
        let diagonal = default_patterns(BoardSize::S5)[10];
        let mut marks = initial_marks(BoardSize::S5, true);
        for index in [0usize, 1, 3, 4] {
            marks.set(index, index).unwrap();
        }
        assert_eq!(
            diagonal & marks.bits(),
            diagonal,
            "free centre must complete the diagonal"
        );
    }

    #[test]
    fn named_patterns_cover_the_expected_positions() {
        for size in [BoardSize::S3, BoardSize::S5, BoardSize::S7, BoardSize::S9] {
            assert_eq!(four_corners(size).count_ones(), 4);
            assert_eq!(blackout(size).count_ones(), u32::from(size.as_u8()).pow(2));
        }
    }
}
