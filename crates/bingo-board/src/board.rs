use serde::{Deserialize, Serialize};

/// A supported square bingo board size.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum BoardSize {
    S3,
    S5,
    S7,
    S9,
}

impl BoardSize {
    /// Converts a numeric size when it is supported.
    pub const fn from_u8(size: u8) -> Option<Self> {
        match size {
            3 => Some(Self::S3),
            5 => Some(Self::S5),
            7 => Some(Self::S7),
            9 => Some(Self::S9),
            _ => None,
        }
    }

    /// Returns the side length.
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::S3 => 3,
            Self::S5 => 5,
            Self::S7 => 7,
            Self::S9 => 9,
        }
    }

    /// Returns the number of cells on the board.
    pub const fn positions(self) -> usize {
        let side = self.as_u8() as usize;
        side * side
    }

    /// Returns the largest number used by the board.
    pub const fn max_number(self) -> u8 {
        self.as_u8() * 15
    }

    /// Returns the row-major index of the center cell.
    pub const fn center_index(self) -> usize {
        self.positions() / 2
    }
}

/// A fixed-size row-major bingo card.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Card {
    cells: [u8; 81],
    size: BoardSize,
}

impl Card {
    /// Creates a card from its fixed cell storage and active size.
    pub const fn from_cells(cells: [u8; 81], size: BoardSize) -> Self {
        Self { cells, size }
    }

    /// Returns a cell, or zero when the coordinates are outside this card.
    pub fn cell(&self, row: usize, col: usize) -> u8 {
        self.offset(row, col)
            .and_then(|offset| self.cells.get(offset))
            .copied()
            .unwrap_or(0)
    }

    /// Returns the complete fixed storage backing the card.
    pub const fn cells(&self) -> &[u8; 81] {
        &self.cells
    }

    /// Returns the card size.
    pub const fn size(&self) -> BoardSize {
        self.size
    }

    /// Returns the row and column carrying a number, or `None` when the card
    /// does not carry it. Zero fills the free cell and every slot outside the
    /// active board, so it is never located.
    pub fn position_of(&self, number: u8) -> Option<(usize, usize)> {
        if number == 0 {
            return None;
        }
        let side = usize::from(self.size.as_u8());
        let offset = self
            .cells
            .iter()
            .copied()
            .take(self.size.positions())
            .position(|cell| cell == number)?;
        Some((offset / side, offset % side))
    }

    fn offset(&self, row: usize, col: usize) -> Option<usize> {
        let side = usize::from(self.size.as_u8());
        if row >= side || col >= side {
            return None;
        }
        Some(row * side + col)
    }
}

/// The set of numbers that have been drawn.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Drawn([u64; 3]);

impl Drawn {
    /// Inserts a nonzero number when it fits in the set.
    pub fn insert(&mut self, number: u8) {
        let Some((word_index, bit)) = Self::location(number) else {
            return;
        };
        let Some(word) = self.0.get_mut(word_index) else {
            return;
        };
        *word |= 1u64 << bit;
    }

    /// Removes a nonzero number when it fits in the set.
    pub fn clear(&mut self, number: u8) {
        let Some((word_index, bit)) = Self::location(number) else {
            return;
        };
        let Some(word) = self.0.get_mut(word_index) else {
            return;
        };
        *word &= !(1u64 << bit);
    }

    /// Returns whether a nonzero number is present.
    pub fn contains(&self, number: u8) -> bool {
        let Some((word_index, bit)) = Self::location(number) else {
            return false;
        };
        self.0
            .get(word_index)
            .is_some_and(|word| word & (1u64 << bit) != 0)
    }

    /// Returns the number of set entries.
    pub fn count(&self) -> u32 {
        self.0.iter().map(|word| word.count_ones()).sum()
    }

    fn location(number: u8) -> Option<(usize, u32)> {
        let index = usize::from(number.checked_sub(1)?);
        Some((index / 64, (index % 64) as u32))
    }
}

/// Error returned when mark coordinates are outside their board.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MarkError;

/// A position mask associated with a board size.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Marks {
    bits: u128,
    size: BoardSize,
}

impl Marks {
    /// Creates an empty mark mask.
    pub const fn new(size: BoardSize) -> Self {
        Self { bits: 0, size }
    }

    /// Sets a cell when the coordinates are valid.
    pub fn set(&mut self, row: usize, col: usize) -> Result<(), MarkError> {
        let Some(bit) = self.bit(row, col) else {
            return Err(MarkError);
        };
        self.bits |= bit;
        Ok(())
    }

    /// Clears a cell when the coordinates are valid.
    pub fn clear(&mut self, row: usize, col: usize) -> Result<(), MarkError> {
        let Some(bit) = self.bit(row, col) else {
            return Err(MarkError);
        };
        self.bits &= !bit;
        Ok(())
    }

    /// Returns whether a cell is marked. Invalid coordinates are never marked.
    pub fn get(&self, row: usize, col: usize) -> bool {
        self.bit(row, col).is_some_and(|bit| self.bits & bit != 0)
    }

    /// Returns the raw position bits.
    pub const fn bits(&self) -> u128 {
        self.bits
    }

    /// Returns the number of marked positions.
    pub const fn popcount(&self) -> u32 {
        self.bits.count_ones()
    }

    /// Returns the board size associated with this mask.
    pub const fn size(&self) -> BoardSize {
        self.size
    }

    fn bit(&self, row: usize, col: usize) -> Option<u128> {
        let side = usize::from(self.size.as_u8());
        if row >= side || col >= side {
            return None;
        }
        let position = row * side + col;
        Some(1u128 << position)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_size_covers_exactly_the_supported_set() {
        for (value, size) in [
            (3, BoardSize::S3),
            (5, BoardSize::S5),
            (7, BoardSize::S7),
            (9, BoardSize::S9),
        ] {
            assert_eq!(BoardSize::from_u8(value), Some(size));
            assert_eq!(size.as_u8(), value);
            assert_eq!(size.center_index(), size.positions() / 2);
        }
        for bad in [0u8, 1, 2, 4, 11, 255] {
            assert_eq!(
                BoardSize::from_u8(bad),
                None,
                "size {bad} must be unsupported"
            );
        }
    }

    #[test]
    fn bit_widths_are_sufficient_at_the_largest_size() {
        assert_eq!(BoardSize::S9.max_number(), 135);
        assert_eq!(BoardSize::S9.positions(), 81);
        assert!(
            BoardSize::S9.max_number() as usize <= 192,
            "Drawn is [u64; 3]"
        );
        assert!(BoardSize::S9.positions() <= 128, "Marks is u128");
    }

    #[test]
    fn drawn_set_round_trips_every_number() {
        let mut drawn = Drawn::default();
        for n in 1..=135u8 {
            assert!(!drawn.contains(n));
            drawn.insert(n);
            assert!(drawn.contains(n));
        }
        assert!(!drawn.contains(0));
        assert_eq!(drawn.count(), 135);
        drawn.insert(0);
        drawn.insert(255);
        assert!(!drawn.contains(255));
        assert_eq!(drawn.count(), 135);
        drawn.clear(64);
        drawn.clear(0);
        drawn.clear(255);
        assert!(!drawn.contains(64));
        assert_eq!(drawn.count(), 134);
    }

    #[test]
    fn marks_validate_coordinates_and_support_clearing() {
        let mut marks = Marks::new(BoardSize::S3);
        assert_eq!(marks.size(), BoardSize::S3);
        assert_eq!(marks.set(2, 2), Ok(()));
        assert!(marks.get(2, 2));
        assert_eq!(marks.bits(), 1 << 8);
        assert_eq!(marks.popcount(), 1);
        assert_eq!(marks.clear(2, 2), Ok(()));
        assert!(!marks.get(2, 2));
        assert_eq!(marks.set(3, 0), Err(MarkError));
        assert_eq!(marks.clear(0, 3), Err(MarkError));
        assert!(!marks.get(usize::MAX, usize::MAX));
    }

    #[test]
    fn card_access_is_row_major_and_total() {
        let mut cells = [0u8; 81];
        cells[8] = 42;
        let card = Card::from_cells(cells, BoardSize::S3);
        assert_eq!(card.size(), BoardSize::S3);
        assert_eq!(card.cell(2, 2), 42);
        assert_eq!(card.cell(3, 0), 0);
        assert_eq!(card.cell(0, usize::MAX), 0);
        assert_eq!(card.cells()[8], 42);
    }

    #[test]
    fn a_number_is_located_only_where_the_card_carries_it() {
        let mut cells = [0u8; 81];
        cells[5] = 42;
        cells[9] = 7;
        let card = Card::from_cells(cells, BoardSize::S3);
        assert_eq!(card.position_of(42), Some((1, 2)));
        assert_eq!(card.position_of(99), None);
        assert_eq!(card.position_of(0), None, "the free cell is never located");
        assert_eq!(
            card.position_of(7),
            None,
            "storage past the active board is not searched"
        );
    }

    #[test]
    fn board_bitsets_survive_serde_round_trips() {
        let mut drawn = Drawn::default();
        drawn.insert(75);
        let decoded_drawn: Drawn =
            serde_json::from_str(&serde_json::to_string(&drawn).unwrap()).unwrap();
        assert_eq!(decoded_drawn, drawn);

        let mut marks = Marks::new(BoardSize::S5);
        marks.set(2, 2).unwrap();
        let decoded_marks: Marks =
            serde_json::from_str(&serde_json::to_string(&marks).unwrap()).unwrap();
        assert_eq!(decoded_marks, marks);
    }
}
