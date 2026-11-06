# TimeCapsule browser frontend

A standalone static frontend for the Solana program in this repository. The original TimeCapsule navigation, full homepage, stylesheets, fonts, images, translations, form components, cards and dialogs are reused directly. The legacy V1 browser codec and independent Solana client supply the behavior. It does not require the full application's login service, database or backend.

## Run locally

Use Node.js 24:

```sh
cd web
npm ci
npm run dev
```

Open the local address printed by Vite. All nine original interface languages are supported. To create a capsule, use a Phantom browser extension with **Devnet test SOL**, write a text memory, choose a future unlock time, encrypt and review the fee, then approve the displayed transactions yourself in Phantom. Download and retain the recovery card after publication.

Private capsules require an independent passphrase of at least 12 characters. Keep it separately from the recovery card; there is no account or password-reset service. Public titles are visible immediately. Public content becomes decryptable when its drand time signal is available; Private V1 capsules additionally require the passphrase.

The complete encrypted payload is stored in a Solana account. The recovery page accepts the account address (PDA) or a Recovery Card v2 and works without connecting a wallet. “My capsules” and “Explore” read accounts directly from RPC; no application indexer is used.

## Public configuration only

The default is the public Solana Devnet RPC. Read-only retries may use the public OnFinality Devnet endpoint when the default is unavailable; broadcasts are not automatically replayed. Custom endpoints remain on the configured provider. No environment file is required. To choose a browser-compatible endpoint, copy `.env.example` to `.env.local` and set `VITE_SOLANA_RPC_URL`, then restart Vite. **Every `VITE_*` value is public in the built website. Do not put a private RPC key or other credential in it.**

The client verifies Devnet's genesis hash, program ownership, account layout, PDA identity and payload hash. It reads the fee recipient and fee policy from the chain rather than bundling an operator configuration. The website has no proxy, server routes, database package, SDK archive or deployment credential.

Public RPC services may rate-limit requests or disable account scans. When listing is unavailable, the UI reports the error and offers direct PDA recovery. An endpoint must allow browser CORS requests and the RPC methods used by the client; configure your own public endpoint when necessary.

## Static build

```sh
npm run build
npm run preview
```

`dist/` is a static website and can be served by a static host. Hash routes do not need a server rewrite. This repository contains no automatic deployment workflow.

## Tests

```sh
npm test
npm run test:codec
npm run test:drand
```

`npm test` covers transaction planning, wallet-signature checks, pending-upload reconciliation, recovery validation, oracle pricing and the pre-request size limit using local fixtures. `test:codec` uses real drand endpoints and waits for a future signal to test public/private encryption and decryption, rejected early opening and incorrect passphrases. It writes only a synthetic public interoperability vector to the repository's ignored `target/` directory; `test:drand` reads that vector. These tests do not use a personal wallet or publish a live Solana transaction.

## Scope and limits

- **V1 text only.** No Solana photos, V2 shared-memory implementation, account login or invitations are included.
- Ciphertext plus any public-title bytes are capped at **8,192 bytes before an RPC or wallet request**. Encryption adds overhead, so the plaintext character count is not the storage limit.
- Interrupted uploads retain ciphertext, public metadata and transaction signatures in browser local storage so they can be reconciled before another wallet request. Plaintext is persisted only when the user explicitly chooses Save as Local Draft, with the original unencrypted-storage disclosure visible. Passphrases and decrypted keys are never included.
- The client clears cost reviews and decryption state when the wallet account changes. Closing a capsule clears its displayed plaintext and passphrase.
- Publishing a memory still requires a real user to review and sign the wallet requests. Automated verification is separate from real-wallet acceptance.

The original sign-in presentation connects a Phantom wallet locally in this edition. It does not contact the private account service or establish a hosted account session.
