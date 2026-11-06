# TimeCapsule — Solana Program

TimeCapsule lets people publish encrypted text memories with a future unlock time. This repository contains the Solana on-chain program and a standalone local demonstration for the [Encode Club Solana Hackathon 2026](https://www.encodeclub.com/programmes/solana-hackathon-2026).

Solana stores the complete payload in a program-derived account (PDA), rather than only a pointer to an external storage service. The program verifies upload integrity and ownership, finalizes the record, and settles the protocol fee in the same transaction. A finalized record can be read directly from Solana without the application backend.

This is a scoped source release of the Solana program. The application frontend, backend, database, client encryption/decryption and account/recovery implementation are outside this repository. The local demonstration exercises the chain interface with synthetic bytes; it does not demonstrate encryption or timed decryption. Ciphertext and metadata are publicly readable on Solana. Cryptographic enforcement of the unlock time belongs to the external client encryption layer, not to this program.

## What is included

| Path | Purpose |
| --- | --- |
| `programs/time_capsule/src/lib.rs` | Config, capsule upload/finalization, ownership, integrity and cleanup rules; unit tests |
| `programs/time_capsule/src/fees.rs` | Fixed SOL or oracle-priced SOL fees, signed fee limits and oracle validation; unit tests |
| `idl/time_capsule.json` | Anchor interface definition for accounts, instructions, events and errors |
| `scripts/local-validator.mjs` | Self-contained local validator demonstration using temporary test signers |
| `docs/PROTOCOL.md` | Account layout, instruction lifecycle and integration limits |

The public Devnet program address is [`4VLB65nCDvzL34cHfHvdizzc6eFMKoGqgSsWe5waBmFr`](https://explorer.solana.com/address/4VLB65nCDvzL34cHfHvdizzc6eFMKoGqgSsWe5waBmFr?cluster=devnet). This release retains its public address and canonical oracle constants. It includes no deployment wallet, administrator identity, fee-recipient setting, authenticated RPC endpoint or deployed Config snapshot. The source files are not a claim of a fresh live deployment or byte-for-byte verification of the deployed binary.

## Setup and unit tests

The extraction was validated with Rust/Cargo 1.99.0, Anchor CLI 1.2.1, Solana CLI 4.2.1 and Node.js 24.17.0. The Rust dependency is pinned to `anchor-lang = 1.2.1`. Node.js must be at least 20.18.0. Both dependency lockfiles are included.

```sh
git clone https://github.com/jiushi506/TimeCapsule-Sol.git
cd TimeCapsule-Sol
cargo test --locked --workspace
```

These tests exercise account sizing, format/title/payload validation, PDA separation, oracle decoding and freshness, integer fee calculation, and signed fee caps, revisions and deadlines. They need no environment file, wallet or RPC connection.

## Build and run the local demonstration

Install the Solana SBF build tools and `solana-test-validator`, then run:

```sh
npm ci
npm run build:program
npm run test:local
```

The demonstration starts a validator on `127.0.0.1`, loads the locally built program, generates temporary signers in memory and funds them using the local faucet. It initializes a synthetic fixed-fee policy, publishes and reads back private-mode V1/V2 test records, verifies exact SHA-256 bytes and fee transfers, checks invalid offsets and format versions, and cancels a maximum-size reservation. It stops the validator and removes its temporary ledger on exit. Ports 19489, 19498, 19499 and 19500–19540 must be free.

The 65,536-byte case tests reservation and cancellation only; it does not prove that a payload of that size can be uploaded or finalized. The current application restricts Solana to text and caps ciphertext plus public-title bytes at **8,192 bytes** before any wallet or RPC request. The program retains its historical 65,536-byte serialized payload ceiling; the current default runtime heap does not safely support full records at that ceiling. This extracted release preserves the program behavior.

`Anchor.toml` defaults to localnet. Build output, generated keypairs, validator ledgers, environment files and local settings are ignored. The local demonstration does not read a personal wallet or send transactions to Devnet/Mainnet.

## Protocol overview

1. `begin_capsule` reserves an owner/ID-specific PDA, fixes payload length and SHA-256, and funds the storage deposit.
2. `write_chunk` appends payload bytes at the exact next offset. Public V1 capsules also use `write_title_chunk`.
3. `finalize_capsule` checks completeness, title validity, payload hash, unlock time and the signed fee constraints before settling the fee and marking the account final.
4. The owner can cancel an unfinished upload. After the upload deadline, anyone can reclaim it with rent returned to its recorded owner. Final records cannot use either cleanup path.

See [the protocol reference](docs/PROTOCOL.md) for PDA seeds, limits, fee modes and trust boundaries.
