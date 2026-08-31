#![allow(clippy::expect_used)]

/// The `rand` crate's sampling helpers are not value-stable across releases:
/// its 0.9.0 changelog documents reproducibility-breaking changes to `shuffle`,
/// `choose_multiple` and `Uniform`. This crate's card layouts and draw order are
/// a published wire protocol, so it depends on `rand_chacha`'s documented-portable
/// generator and writes every sampling step by hand. `rand` must therefore stay
/// out of the tree entirely, including as a transitive dependency of a crate
/// added later.
///
/// `--prefix none` is what makes this check work. The default output indents
/// dependencies with box-drawing characters, so `rand` only ever appears as
/// `├── rand v0.9.5` and a bare prefix match would silently never fire.
#[test]
fn rand_crate_is_not_in_the_dependency_tree() {
    let out = std::process::Command::new(env!("CARGO"))
        .args(["tree", "--workspace", "-e", "normal", "--prefix", "none"])
        .output()
        .expect("cargo tree");
    assert!(
        out.status.success(),
        "cargo tree failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let tree = String::from_utf8_lossy(&out.stdout);
    for line in tree.lines() {
        let name = line.split_whitespace().next().unwrap_or_default();
        assert_ne!(
            name, "rand",
            "the `rand` crate entered the dependency tree; its sampling helpers are not value-stable\n{tree}"
        );
    }
}

/// A guard is worthless if it cannot fail, so pin the matching itself against
/// the shape `cargo tree` really emits rather than against a hand-written guess.
#[test]
fn the_guard_matches_the_shape_cargo_tree_emits() {
    let caught = |line: &str| line.split_whitespace().next().unwrap_or_default() == "rand";

    assert!(caught("rand v0.9.5"));
    assert!(caught("rand v0.9.5 (proc-macro)"));
    assert!(!caught("rand_core v0.9.5"));
    assert!(!caught("rand_chacha v0.9.0"));
    assert!(!caught(""));
}
