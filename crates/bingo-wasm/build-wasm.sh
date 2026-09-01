#!/usr/bin/env bash
set -euo pipefail

crate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace_dir="$(cd "${crate_dir}/../.." && pwd)"
wasm_input="${workspace_dir}/target/wasm32-unknown-unknown/wasm-release/bingo_wasm.wasm"
output_dir="${crate_dir}/pkg"

cargo build -p bingo-wasm --profile wasm-release --target wasm32-unknown-unknown --manifest-path "${workspace_dir}/Cargo.toml"
wasm-bindgen --target web --out-dir "${output_dir}" "${wasm_input}"

wasm_output="${output_dir}/bingo_wasm_bg.wasm"
wasm_bytes="$(wc -c < "${wasm_output}")"
echo "${wasm_output}: ${wasm_bytes} bytes"
