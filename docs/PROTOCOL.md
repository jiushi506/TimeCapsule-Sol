# Solana protocol reference

## Accounts

All addresses below are PDAs derived under the program ID in `declare_id!` and the IDL.

| Account | Seeds | Purpose |
| --- | --- | --- |
| Config | UTF-8 `config-v1` | Administrator, fee recipient, fixed SOL fee, payload ceiling and minimum lock duration |
| FeePolicy | UTF-8 `fee-policy-v1` | Fee mode, revision, USDC target and oracle quality bounds |
| Capsule | UTF-8 `capsule-v1`, owner public-key bytes, capsule ID as little-endian `u64` | Metadata, expected lengths/hash, upload progress, public title and complete payload |

Capsule IDs are chosen by the owner. There is no shared global counter. Initial Config creation requires the deployed program's upgrade authority. Config and FeePolicy changes require the configured administrator.

## Upload lifecycle

`begin_capsule` records a future unlock timestamp, a mode (`Public` or `Private`), format version, expected lengths and SHA-256. The unlock time must be strictly greater than the current chain clock plus Config's minimum lock duration. An upload expires 24 hours after it begins. The owner pays rent for the final declared account allocation at reservation time.

`write_chunk` and `write_title_chunk` require the owner to sign. Each write must start at the exact next byte offset, and may not exceed the declared length. The program accepts at most 3,800 bytes per chunk, but transaction encoding and network/wallet limits can require much smaller writes. The local test uses 800-byte chunks.

`finalize_capsule` requires all declared bytes, a matching SHA-256, valid public-title bytes, an unlock time still in the future, and an accepted fee review. The fee transfer and transition to `Final` are atomic. This program has no instruction to modify or close a finalized Capsule. The upgrade authority can change program code, so this statement describes the published implementation rather than an immutable-program guarantee.

`cancel_upload` closes an unfinished upload with its owner's signature. `reclaim_expired_upload` can close an unfinished upload after its deadline without that signature, but rent must return to the recorded owner. Neither can close a finalized record.

## Formats, visibility and size

V1 is accepted in Public and Private modes. V2 is accepted only in Private mode. The program stores and hashes opaque bytes; it does not implement encryption, inspect a ciphertext envelope, verify a time-release proof or conceal account data until the unlock time. Clients must encrypt before uploading. The local demonstration intentionally uses synthetic, non-secret data.

Public capsules require a nonblank UTF-8 title of at most 2,048 bytes and 512 Unicode scalar values. Private capsules must have no public title. Metadata, titles and stored payload bytes are public account data on Solana.

The serialized payload field has a historical program ceiling of 65,536 bytes, additionally bounded by Config. This is not a demonstrated runtime upload limit: the application uses an 8,192-byte combined ciphertext/title cap to avoid exhausting the default program heap. Solana memories are text-only in the current application. The local test reserves then cancels a 65,536-byte account without uploading that payload.

## Fees

`FixedSol` uses the lamport amount in Config. `UsdcEquivalentSol` converts the policy's integer USDC-micro target into lamports using SOL/USD and USDC/USD oracle prices, rounding up.

For dynamic pricing the program checks the canonical oracle addresses and owner, account discriminator, complete verification level, feed IDs, positive prices, supported exponents, age, future timestamp tolerance, confidence bounds and cross-feed timestamp skew. The addresses and feed IDs are public protocol constants in `fees.rs`.

The finalization instruction includes the wallet-signed maximum fee, expected policy revision and quote deadline. Stale reviews, expired deadlines and fees above the cap fail. Both fee-policy changes and Config updates invalidate old reviews through a revision increment. Storage rent and network transaction fees are separate from the protocol fee.

## Verification scope

Rust unit tests cover local validation and fee arithmetic. The local validator demonstration covers actual instruction execution, storage/readback, fixed-fee transfers and selected rejection paths with synthetic records. It does not exercise live oracle settlement, real-wallet interactions, client encryption/decryption, the application backend or a production deployment. The checked-in IDL and public program ID let reviewers inspect the interface independently.
