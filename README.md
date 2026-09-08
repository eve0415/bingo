# Bingo

A deterministic bingo engine, a room server that runs games with it, and one worked example of a client.

The engine decides everything a game of bingo needs decided — how a card is dealt, what the draw order is, whether a mark is legal, when a line is a reach and when it is a win — from a single seed, in Rust, compiled to WebAssembly. The room server wraps it in a Cloudflare Worker: one Durable Object per room, holding the event log, driving the engine, and broadcasting the result to whoever is connected. Neither half knows or cares who your players are or what your interface looks like.

`activity/` is a client: a Discord Activity for playing in a voice call. It is an example of the integration rather than the point of the project, and a web app, a native app or a bot would connect the same way.

## The pieces

| Package              | Deployed as             | Role                                                                                              |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `crates/bingo-board` | —                       | Board geometry: sizes, cards, drawn-number and mark bitsets, pattern analysis.                    |
| `crates/bingo-core`  | —                       | The rules: commands, events, the reducer, seed derivation, projection and replay.                 |
| `crates/bingo-wasm`  | WebAssembly module      | The JSON boundary over the engine, and the source of the generated TypeScript DTOs.               |
| `wrapper/`           | Worker `bingo`          | The room server: HTTP and WebSocket routes over a `Room` Durable Object. See `wrapper/README.md`. |
| `activity/`          | Worker `bingo-activity` | An example client: bingo as a Discord Activity. See `activity/README.md`.                         |

## The engine is deterministic on purpose

`bingo-core` takes one 32-byte seed and derives everything from it. HKDF-SHA256 with per-purpose tags expands that seed into an independent seed for each card and for the draw order, and ChaCha8 turns those into the shuffles. The draw is a full permutation fixed the moment the seed is known, not a number invented per click.

Sampling is written by hand against `rand_chacha` rather than taken from `rand`, and guard tests assert that neither `rand` nor `getrandom` can enter the dependency tree. `rand` makes no value-stability promise across releases, so a routine upgrade of it could silently reshuffle every card and draw sequence ever generated from a given seed. Card layouts are a published wire format, and a game has to replay the same way tomorrow as it did tonight.

That determinism is what the rest of the system leans on. A room can cache one snapshot per game and rebuild it from the event log on a miss; `replay` re-derives each command from each recorded event and re-runs it, so a log can be audited against the engine that wrote it. It is also what makes the deal verifiable: the room publishes a commitment over the seed and the roster the moment a game starts, and the seed itself is withheld from every projection until the phase reaches `Finished`. A player who suspects the host can then check the revealed seed against the commitment they were shown at the start, and re-derive every card and the whole draw order from it.

The workspace lints hold the engine to it: `unsafe_code` is forbidden, and `indexing_slicing`, `unwrap_used`, `expect_used` and `panic` are denied. Built under the `wasm-release` profile the module is 309,359 bytes.

## The wire types come from Rust

`ts-rs` exports the engine's DTOs to `crates/bingo-wasm/bindings/*.ts`, and `wrapper/src/protocol.ts` asserts at compile time that its game-config and command schemas infer to exactly the generated `ConfigDto` and `CommandDto`. A game-config change made in Rust and not mirrored in the schema fails the type check rather than reaching the wire. A TypeScript client can import the same generated types and be wrong in the same place the server would be.

## Writing a client

The room server never authenticates anyone. It reads the player off a `x-bingo-verified-identity` header — a JSON `{ player: { issuer, subject }, displayName }` — and trusts it, which is why `bingo` sets `workers_dev: false` and is reachable only over a service binding from a front-end Worker you control.

That front end is the client's own job, and it is the whole of the integration: sign your users in however you like, decide what a room is in your product, and forward the request with an identity attached. `issuer` names your provider and `subject` is your id within it — the Discord client sends `discord`, and a web front end would send its own. The room compares the pair and otherwise never looks inside it, so a player's name and picture stay on your side of the boundary.

`wrapper/README.md` is the contract: routes, message shapes, command authorization and room lifecycle. `activity/README.md` is that contract implemented once, against Discord.

## Prerequisites

The devcontainer in `.devcontainer/` provides all of these; use it and skip this section.

- Rust `1.98.0` with the `wasm32-unknown-unknown` target, pinned in `rust-toolchain.toml`.
- `wasm-bindgen-cli` at exactly `0.2.127`, which has to match the `wasm-bindgen` pin in the workspace `Cargo.toml`.
- Node `24.20.0` and pnpm `12.1.0`, both pinned in the root `package.json`.

## Getting started

```sh
pnpm install
pnpm -C activity dev
```

The example client's dev server is the whole stack: the Cloudflare Vite plugin builds and serves `wrapper/` alongside it as an auxiliary worker, so the service binding is live locally rather than stubbed. The Discord credentials that client needs are in `activity/README.md`; the room server needs no secrets of its own.

## Generated files

None of these are committed, and each is produced by the build.

| Artifact                                                                  | Produced by                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `crates/bingo-wasm/pkg/`                                                  | `pnpm --filter @bingo/wasm build`, which runs `cargo build` then `wasm-bindgen`.   |
| `crates/bingo-wasm/bindings/*.ts`                                         | `pnpm --filter @bingo/wasm generate:bindings`, which exports through `cargo test`. |
| `activity/worker-configuration.d.ts`, `wrapper/worker-configuration.d.ts` | `pnpm -C <package> types`, which runs `wrangler types`.                            |
| `activity/app/routeTree.gen.ts`                                           | The TanStack Start Vite plugin, on dev or build.                                   |

`pnpm -C <package> generate` produces the full set for a package, and the root lint scripts run it first. Linting therefore needs the Rust toolchain, not only Node.

## Commands

| Command                                                 | Effect                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm -C activity dev`                                  | Runs the example client and the room server together.                    |
| `pnpm -C activity test`, `pnpm -C wrapper test`         | Runs that package's suite.                                               |
| `pnpm -C <package> test:coverage`                       | The same suite with coverage, which is where the threshold is enforced.  |
| `pnpm lint`                                             | Formats and fixes the TypeScript and configuration files.                |
| `pnpm lint:check`                                       | The same pass in check mode.                                             |
| `cargo test --workspace`                                | Runs the Rust tests, including the dependency guards and the DTO export. |
| `cargo clippy --workspace --all-targets -- -D warnings` | Lints Rust under the workspace deny list.                                |
| `cargo fmt --check`                                     | Checks Rust formatting.                                                  |

Both TypeScript packages run their tests inside `workerd` through `@cloudflare/vitest-pool-workers`, against the same `wrangler.json` they deploy with, so bindings and Durable Objects behave in test as they do in production. Coverage is istanbul and the threshold is 100% of statements, branches, functions and lines in both. The measured set is all of `wrapper/src`, and on the client side its TypeScript modules under `app`; most React components and the Discord SDK glue sit outside it, because a browser is the only place they run for real.

Nothing runs any of this automatically — the repository carries no CI configuration — so a change is verified by running the list above before it is pushed.

## Deploying

Deploy the room server first; a client's service binding needs `bingo` to already exist.

```sh
pnpm -C wrapper deploy
pnpm -C activity deploy
```

## License

MIT. See `LICENSE`.
