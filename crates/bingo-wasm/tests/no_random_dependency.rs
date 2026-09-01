#![allow(clippy::expect_used)]

fn dependency_name(line: &str) -> &str {
    line.split_whitespace().next().unwrap_or_default()
}

#[test]
fn random_sources_are_not_in_the_dependency_tree() {
    let output = std::process::Command::new(env!("CARGO"))
        .args([
            "tree",
            "-p",
            "bingo-wasm",
            "-e",
            "normal",
            "--prefix",
            "none",
        ])
        .output()
        .expect("cargo tree");
    assert!(
        output.status.success(),
        "cargo tree failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let tree = String::from_utf8_lossy(&output.stdout);
    for line in tree.lines() {
        assert!(
            !matches!(dependency_name(line), "rand" | "getrandom"),
            "a random source entered bingo-wasm's dependency tree\n{tree}"
        );
    }
}

#[test]
fn dependency_matching_uses_exact_crate_names() {
    assert_eq!(dependency_name("rand v0.9.5"), "rand");
    assert_eq!(dependency_name("getrandom v0.3.3"), "getrandom");
    assert_eq!(dependency_name("rand_core v0.9.5"), "rand_core");
    assert_eq!(dependency_name(""), "");
}
