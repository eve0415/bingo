use crate::Marks;

/// Completed patterns and patterns that need one more mark.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Analysis {
    pub bingo: Vec<u128>,
    pub reach: Vec<u128>,
}

/// Evaluates arbitrary position masks against the current marks.
pub fn analyze(patterns: &[u128], marks: &Marks) -> Analysis {
    let marked = marks.bits();
    let mut bingo = Vec::new();
    let mut reach = Vec::new();
    for &pattern in patterns {
        let hits = (pattern & marked).count_ones();
        let required = pattern.count_ones();
        if hits == required {
            bingo.push(pattern);
        } else if hits + 1 == required {
            reach.push(pattern);
        }
    }
    Analysis { bingo, reach }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{BoardSize, blackout, default_patterns, four_corners, initial_marks};

    #[test]
    fn reach_generalises_beyond_full_lines() {
        let size = BoardSize::S5;
        let corners = four_corners(size);
        let mut marks = initial_marks(size, false);
        marks.set(0, 0).unwrap();
        marks.set(0, 4).unwrap();
        marks.set(4, 0).unwrap();
        let analysis = analyze(&[corners], &marks);
        assert!(analysis.reach.contains(&corners), "3 of 4 corners is reach");
        assert!(analysis.bingo.is_empty());

        let blackout = blackout(size);
        let mut few = initial_marks(size, false);
        for index in 0..4 {
            few.set(0, index).unwrap();
        }
        let analysis = analyze(&[blackout], &few);
        assert!(analysis.reach.is_empty(), "4 of 25 is not reach");
    }

    #[test]
    fn analysis_reports_bingo_and_remaining_reaches_together() {
        let size = BoardSize::S5;
        let patterns = default_patterns(size);
        let mut marks = initial_marks(size, false);
        for col in 0..5 {
            marks.set(0, col).unwrap();
        }
        for col in 0..4 {
            marks.set(1, col).unwrap();
        }
        let analysis = analyze(&patterns, &marks);
        assert_eq!(analysis.bingo.len(), 1);
        assert!(
            !analysis.reach.is_empty(),
            "reaches must still be reported alongside a bingo"
        );
    }
}
