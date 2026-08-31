use core::num::NonZeroU32;
use rand_core::RngCore;

#[inline]
pub(crate) fn rejection_threshold(n: NonZeroU32) -> u32 {
    n.get().wrapping_neg() % n.get()
}

/// Returns a uniform value in `0..n` by consuming whole `u32` words.
///
/// This is Lemire's multiply-high method with rejection. A nonzero bound is
/// required by the type so callers cannot create an invalid sampling range.
pub(crate) fn bounded<R: RngCore>(rng: &mut R, n: NonZeroU32) -> u32 {
    let threshold = rejection_threshold(n);
    let n = u64::from(n.get());
    loop {
        let m = u64::from(rng.next_u32()) * n;
        if (m as u32) >= threshold {
            return (m >> 32) as u32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_chacha::ChaCha8Rng;
    use rand_core::SeedableRng;

    const EXPECTED_WORDS_SEED_7: [u32; 8] = [
        1_506_529_508,
        958_315_583,
        3_665_904_614,
        3_572_840_331,
        201_949_911,
        1_249_180_121,
        502_987_689,
        1_519_949_754,
    ];

    fn nz(n: u32) -> NonZeroU32 {
        NonZeroU32::new(n).unwrap_or(NonZeroU32::MIN)
    }

    #[test]
    fn threshold_matches_two_pow_32_mod_n() {
        for n in 1u32..=200 {
            let expected = ((1u64 << 32) % u64::from(n)) as u32;
            assert_eq!(rejection_threshold(nz(n)), expected, "n = {n}");
        }
    }

    #[test]
    fn bounded_stays_in_range_and_is_deterministic() {
        let mut a = ChaCha8Rng::from_seed([7u8; 32]);
        let mut b = ChaCha8Rng::from_seed([7u8; 32]);
        for _ in 0..10_000 {
            let x = bounded(&mut a, nz(15));
            assert!(x < 15);
            assert_eq!(x, bounded(&mut b, nz(15)));
        }
    }

    struct Fixed {
        words: Vec<u32>,
        i: usize,
    }

    impl RngCore for Fixed {
        fn next_u32(&mut self) -> u32 {
            let w = self.words[self.i];
            self.i += 1;
            w
        }

        fn next_u64(&mut self) -> u64 {
            rand_core::impls::next_u64_via_u32(self)
        }

        fn fill_bytes(&mut self, dst: &mut [u8]) {
            rand_core::impls::fill_bytes_via_next(self, dst);
        }
    }

    #[test]
    fn the_rejection_branch_is_taken_and_discards_the_word() {
        let mut r = Fixed {
            words: vec![0, 0x8000_0000],
            i: 0,
        };
        assert_eq!(bounded(&mut r, nz(3)), 1);
        assert_eq!(r.i, 2, "the rejected word is consumed");
    }

    #[test]
    fn the_fixed_helper_implements_the_whole_trait() {
        let mut r = Fixed {
            words: vec![1, 2, 3, 4],
            i: 0,
        };
        let _ = r.next_u64();
        let mut buf = [0u8; 4];
        r.fill_bytes(&mut buf);
    }

    #[test]
    fn golden_chacha8_words() {
        let mut r = ChaCha8Rng::from_seed([7u8; 32]);
        let got: Vec<u32> = (0..8).map(|_| r.next_u32()).collect();
        assert_eq!(got, EXPECTED_WORDS_SEED_7);
    }
}
