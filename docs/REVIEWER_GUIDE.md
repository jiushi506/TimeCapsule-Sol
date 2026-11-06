# Reviewer quick start

This repository is the standalone Solana edition of TimeCapsule. It contains the browser encryption and recovery flow, Phantom integration and the Rust on-chain program. The scope below identifies what can be reproduced when reviewing the TimeCapsule product demo.

## Start the website

Use Node.js 24 (`.nvmrc` is included):

```sh
git clone https://github.com/jiushi506/TimeCapsule-Sol.git
cd TimeCapsule-Sol/web
npm ci
npm run dev
```

Open the local URL printed by Vite. No `.env`, application backend, account registration or private RPC credential is needed.

## Verify recovery without a wallet

1. Open the homepage and choose **Try a live capsule**, or open `/#/recover?capsulePda=5At5wn2mR2SPbexvJtJPHjsmuEBGd4k664dtJzggz6YH` on the local website.
2. Run the account lookup and open the returned capsule.
3. Decrypt the already-unlocked Public V1 capsule. No wallet signature or passphrase is required for this public record.
4. Close the content dialog; the displayed plaintext is cleared. The recovery page can also export a verified recovery card for the account.

This sample was read and decrypted through the checked-in client on 2026-11-07. Its public account is [`5At5wn2mR2SPbexvJtJPHjsmuEBGd4k664dtJzggz6YH`](https://explorer.solana.com/address/5At5wn2mR2SPbexvJtJPHjsmuEBGd4k664dtJzggz6YH?cluster=devnet), with 1,256 payload bytes and SHA-256 `0xa0b5bbbed6f88a786b45b027043e79858d0b65d15db3b768a0bb128ecbc43e72`.

The client verifies Devnet identity, program ownership, PDA derivation, finalized account fields and the payload hash before decryption. drand signatures are verified separately. These are live network reads; RPC rate limits, drand availability or a Devnet reset can affect the sample. If an account list is unavailable, direct PDA lookup avoids an account scan. Public endpoint setup is documented in [the frontend README](../web/README.md#public-configuration-only).

## Verify creation with Phantom

1. Connect a Phantom account funded with Devnet test SOL. Use short, non-sensitive test text.
2. Choose Public or Private. Public capsules need a title; Private capsules need a separate strong passphrase of at least 12 characters.
3. Choose a future unlock time with enough time for encryption, wallet review and upload. A few minutes is more convenient for a manual review than the shortest preset.
4. Encrypt, review the protocol fee, account storage balance and network fees, then approve the transactions yourself in Phantom.
5. Download the recovery card after the account and receipt have been verified. Follow its PDA in Solana Explorer or use Direct Recovery.
6. Try opening before release, then retry after the drand release time. A Private V1 capsule additionally needs its original passphrase.

Saving a local draft is optional and explicitly stores the text unencrypted in that browser. Passphrases are excluded. On successful publication, a private local name is saved in the browser and the corresponding saved text draft is removed. Browser storage failures preserve the confirmed result and report a local housekeeping warning. Interrupted on-chain uploads retain encrypted continuation data so Resume can inspect the chain before requesting another signature.

The application caps encrypted payload plus public-title bytes at 8,192, before quoting or signing that upload. Solana photos are not supported. Real Phantom publishing is a human acceptance step; automated program and codec tests do not substitute for that step.

## Reproduce the automated checks

From `web/`:

```sh
npm test
npm run build
```

For live time-release encryption checks, run these in order:

```sh
npm run test:codec
npm run test:drand
```

The codec test waits for a real future drand signal and writes a synthetic interoperability vector into the ignored `target/` directory. These commands do not request a wallet or publish to Solana.

From the repository root, with the Rust/Solana tools listed in [the README](../README.md#setup-and-unit-tests):

```sh
cargo test --locked --workspace
npm ci
npm run build:program
npm run test:local
```

The local validator demonstration uses temporary in-memory test signers and a local faucet. It covers Public V1 with UTF-8 title chunks, Private V1/V2 opaque test records, exact payload readback and SHA-256, fee transfers, interrupted offsets and invalid inputs. V2 here tests the program's opaque-byte format support; it does not include the full application's V2 codec or sharing implementation. The 65,536-byte case only reserves and cancels storage.

## Submission scope and source map

| Behavior | Source | Reproducible scope |
| --- | --- | --- |
| Original interface and navigation | `web/src/views/`, `web/src/components/`, `web/src/index.css` | Original presentation, nine languages and Solana routes |
| Browser encryption and time release | `web/src/codec/` | V1 public/private text, AES-GCM, Argon2id for private mode and drand |
| Wallet review, uploads and recovery | `web/src/services/solanaCapsuleService.ts` | Phantom signatures, signed fee constraints, interrupted-upload reconciliation, verified chain reads |
| Capsule storage and fees | `programs/time_capsule/src/`, `idl/time_capsule.json` | Rust Anchor program, account layout, instructions, tests and interface |
| Wallet entry and capsule lists | `web/src/context/`, `web/src/services/solanaPublicCapsuleIndex.ts` | Local Phantom connection and direct RPC reads |
| Local drafts and names | `web/src/services/draftService.ts`, `localCapsuleLabelService.ts` | Browser storage scoped by wallet |

The full product's hosted account service, database, invitations, shared-memory V2 implementation, EVM flows, photos and operational secrets are outside this submission. The original wallet-entry presentation connects Phantom locally in this edition; it does not establish a hosted account session. No private application backend is needed for the included Solana flow.

The repository contains source and a public Devnet program ID. The local validator exercises the binary built from this checkout; the live recovery check does not establish a byte-for-byte match between that build and the deployed Devnet program.
