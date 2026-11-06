# Frontend extraction verification

Verified on 2026-11-06. This release reuses the original TimeCapsule navigation, complete homepage, styles, assets, translations, form components, cards and dialogs, backed by the legacy V1 browser codec and an isolated Solana adapter. The original application checkout was left unchanged.

## Follow-up review — 2026-11-07

- Frontend production build and all 62 client tests passed; all 12 Rust unit tests passed.
- The local validator demonstration now also publishes and reads back a Public V1 record with a UTF-8 title written in separate chunks, checking its exact title, payload hash and fee transfer.
- The existing homepage sample PDA was fetched and decrypted again using the checked-in client, without a wallet or application backend. See the [reviewer guide](REVIEWER_GUIDE.md) for the address and verification steps.
- Publishing now preserves the verified success result when browser housekeeping fails, saves the reviewed private local name, and removes the matching wallet's saved text draft. Regression cases cover mismatched owners/payloads and unavailable browser storage.
- Browser checks confirmed saving a synthetic local draft and deleting it immediately updates both the list and count. The synthetic saved draft was removed after the check.
- No Rust program behavior, original styles, private backend or V2 implementation was added or changed.

## Checks performed

| Check | Result |
| --- | --- |
| TypeScript and Vite production build | Passed |
| Solana client tests | 58 passed, including signed transaction validation, fee reviews, upload reconciliation, recovery and RPC failover |
| Live V1 codec checks | 23 passed with a real future drand signal |
| drand interoperability | Passed v1/v2 relay compatibility and signature verification |
| Browser chain reads | Public Devnet capsules loaded directly through public RPC |
| Browser recovery | An existing public V1 account was read by PDA, verified, and decrypted in the static build without login or a wallet |
| Dialog cleanup | Escape closed the capsule and removed displayed plaintext |
| Layout fidelity | At the same 1280px viewport, the original and local homepage title, subtitle, trust panel, action group, use cases and lifecycle had identical DOM rectangles, font families, font sizes and colors |
| Original styles | All original CSS selectors and values preserved; original fonts, images, navigation and nine language dictionaries retained |
| Draft privacy | Explicit Save as Local Draft keeps text locally, excludes passphrase/key fields, and isolates drafts by wallet namespace |
| Source boundary | No server/API directories, database dependency, vendor SDK archive, real environment file, signing material or private V2 implementation included |

The live codec checks confirmed rejection before signal release, public decryption after release, rejection of an incorrect private passphrase, and successful private decryption with the correct passphrase. Only synthetic test content was created by those checks. Their public vector is generated under the ignored `target/` directory.

The default public RPC returned a rate-limit error during browser checks. Read-only failover to a second public Devnet provider was added and tested; broadcasts are never automatically replayed. The final static build completed direct PDA recovery and browser decryption after that change.

## Remaining acceptance scope

No personal wallet was used to create or cancel a live capsule. Real Phantom publishing remains a human acceptance step. The original local validator program demonstration covers synthetic program execution separately.

The inherited `@solana/web3.js` 1.x dependency tree still produces four moderate npm audit findings through `jayson`, `stream-json` and `uuid`. No high or critical findings remained after updating the Vite development dependency. This extraction does not migrate the existing transaction adapter to a different major SDK.

V2 shared memories, photos, account sign-in, invitations and the private application backend are outside this release. The Solana application size cap remains 8,192 combined ciphertext/title bytes.
