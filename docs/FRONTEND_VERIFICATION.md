# Frontend extraction verification

Verified on 2026-11-06. This release adds a static Solana frontend based on the pre-backend V1 browser codec and visual assets, with an isolated Solana adapter. The original application checkout was left unchanged.

## Checks performed

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed |
| Solana client tests | 57 passed, including signed transaction validation, fee reviews, upload reconciliation, recovery and RPC failover |
| Live V1 codec checks | 23 passed with a real future drand signal |
| drand interoperability | Passed v1/v2 relay compatibility and signature verification |
| Browser chain reads | Public Devnet capsules loaded directly through public RPC |
| Browser recovery | An existing public V1 account was read by PDA, verified, and decrypted in the static build without login or a wallet |
| Dialog cleanup | Escape closed the capsule and removed displayed plaintext |
| Responsive layout | Chinese desktop at 1280px and English mobile at 430px rendered without horizontal overflow |
| Source boundary | No server/API directories, database dependency, vendor SDK archive, real environment file, signing material or private V2 implementation included |

The live codec checks confirmed rejection before signal release, public decryption after release, rejection of an incorrect private passphrase, and successful private decryption with the correct passphrase. Only synthetic test content was created by those checks. Their public vector is generated under the ignored `target/` directory.

The default public RPC returned a rate-limit error during browser checks. Read-only failover to a second public Devnet provider was added and tested; broadcasts are never automatically replayed. The final static build completed direct PDA recovery and browser decryption after that change.

## Remaining acceptance scope

No personal wallet was used to create or cancel a live capsule. Real Phantom publishing remains a human acceptance step. The original local validator program demonstration covers synthetic program execution separately.

The inherited `@solana/web3.js` 1.x dependency tree still produces four moderate npm audit findings through `jayson`, `stream-json` and `uuid`. No high or critical findings remained after updating the Vite development dependency. This extraction does not migrate the existing transaction adapter to a different major SDK.

V2 shared memories, photos, account sign-in, invitations and the private application backend are outside this release. The Solana application size cap remains 8,192 combined ciphertext/title bytes.
