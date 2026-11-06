#![allow(unexpected_cfgs)]

use anchor_lang::prelude::SolanaSysvar;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    program::invoke,
    system_instruction,
};
use solana_sha256_hasher::hash;
pub mod fees;
pub use fees::*;

// Keep this declaration and both Anchor.toml cluster entries synced with the
// owner-held program keypair. Never replace that keypair after deployment.
declare_id!("4VLB65nCDvzL34cHfHvdizzc6eFMKoGqgSsWe5waBmFr");

pub const CONFIG_SEED: &[u8] = b"config-v1";
pub const CAPSULE_SEED: &[u8] = b"capsule-v1";
pub const CONFIG_VERSION: u8 = 1;
pub const CAPSULE_VERSION: u8 = 1;
pub const MAX_PAYLOAD_SIZE: u32 = 65_536;
pub const MAX_PUBLIC_TITLE_BYTES: usize = 2_048;
pub const MAX_PUBLIC_TITLE_CHARACTERS: usize = 512;
pub const MAX_WRITE_CHUNK_BYTES: usize = 3_800;
pub const UPLOAD_TTL_SECONDS: i64 = 24 * 60 * 60;
pub const V1_FORMAT_VERSION: u16 = 1;
pub const V2_FORMAT_VERSION: u16 = 2;

#[program]
pub mod time_capsule {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        args: InitializeConfigArgs,
    ) -> Result<()> {
        require_keys_neq!(
            args.fee_recipient,
            Pubkey::default(),
            CapsuleError::ZeroAddress
        );
        require!(
            args.max_payload_size > 0 && args.max_payload_size <= MAX_PAYLOAD_SIZE,
            CapsuleError::InvalidPayloadLimit
        );
        require!(
            args.min_lock_duration >= 0,
            CapsuleError::InvalidLockDuration
        );
        validate_upgrade_authority(&ctx.accounts.program_data, ctx.accounts.admin.key())?;

        let config = &mut ctx.accounts.config;
        config.schema_version = CONFIG_VERSION;
        config.admin = ctx.accounts.admin.key();
        config.fee_recipient = args.fee_recipient;
        config.protocol_fee_lamports = args.protocol_fee_lamports;
        config.max_payload_size = args.max_payload_size;
        config.min_lock_duration = args.min_lock_duration;
        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, args: UpdateConfigArgs) -> Result<()> {
        // Invalidate signed reviews when recipient, fixed fee, or upload settings change.
        ctx.accounts.fee_policy.revision = ctx
            .accounts
            .fee_policy
            .revision
            .checked_add(1)
            .ok_or(CapsuleError::ArithmeticOverflow)?;
        let config = &mut ctx.accounts.config;
        if let Some(fee_recipient) = args.fee_recipient {
            require_keys_neq!(fee_recipient, Pubkey::default(), CapsuleError::ZeroAddress);
            config.fee_recipient = fee_recipient;
        }
        if let Some(protocol_fee_lamports) = args.protocol_fee_lamports {
            config.protocol_fee_lamports = protocol_fee_lamports;
        }
        if let Some(max_payload_size) = args.max_payload_size {
            require!(
                max_payload_size > 0 && max_payload_size <= MAX_PAYLOAD_SIZE,
                CapsuleError::InvalidPayloadLimit
            );
            config.max_payload_size = max_payload_size;
        }
        if let Some(min_lock_duration) = args.min_lock_duration {
            require!(min_lock_duration >= 0, CapsuleError::InvalidLockDuration);
            config.min_lock_duration = min_lock_duration;
        }
        emit!(ConfigUpdated {
            admin: config.admin,
            fee_recipient: config.fee_recipient,
            protocol_fee_lamports: config.protocol_fee_lamports,
            max_payload_size: config.max_payload_size,
            min_lock_duration: config.min_lock_duration,
        });
        Ok(())
    }

    pub fn initialize_fee_policy(
        ctx: Context<InitializeFeePolicy>,
        args: FeePolicyArgs,
    ) -> Result<()> {
        ctx.accounts.fee_policy.apply(args)
    }

    pub fn update_fee_policy(ctx: Context<UpdateFeePolicy>, args: FeePolicyArgs) -> Result<()> {
        ctx.accounts.fee_policy.apply(args)
    }

    pub fn begin_capsule(
        ctx: Context<BeginCapsule>,
        capsule_id: u64,
        unlock_at: i64,
        mode: CapsuleMode,
        format_version: u16,
        expected_payload_len: u32,
        payload_hash: [u8; 32],
        expected_title_len: u16,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        validate_payload_size(expected_payload_len, config.max_payload_size)?;
        validate_format_version(mode, format_version)?;
        validate_title_length(mode, expected_title_len as usize)?;

        let now = Clock::get()?.unix_timestamp;
        let earliest_unlock = now
            .checked_add(config.min_lock_duration)
            .ok_or(CapsuleError::ArithmeticOverflow)?;
        require!(unlock_at > earliest_unlock, CapsuleError::InvalidUnlockTime);
        let expires_at = now
            .checked_add(UPLOAD_TTL_SECONDS)
            .ok_or(CapsuleError::ArithmeticOverflow)?;

        let capsule = &mut ctx.accounts.capsule;
        capsule.schema_version = CAPSULE_VERSION;
        capsule.owner = ctx.accounts.owner.key();
        capsule.capsule_id = capsule_id;
        capsule.created_at = now;
        capsule.unlock_at = unlock_at;
        capsule.mode = mode;
        capsule.format_version = format_version;
        capsule.state = CapsuleState::Uploading;
        capsule.expected_payload_len = expected_payload_len;
        capsule.uploaded_payload_len = 0;
        capsule.payload_hash = payload_hash;
        capsule.expected_title_len = expected_title_len;
        capsule.uploaded_title_len = 0;
        capsule.public_title_bytes = Vec::new();
        capsule.expires_at = expires_at;
        capsule.finalized_at = 0;
        capsule.payload = Vec::new();

        // Pre-fund the final allocation at begin so data writes need no extra
        // rent-transfer instruction and can fit the legacy transaction path.
        let final_space =
            Capsule::space_for(expected_payload_len as usize, expected_title_len as usize);
        let final_rent = Rent::get()?.minimum_balance(final_space);
        let top_up = final_rent.saturating_sub(capsule.to_account_info().lamports());
        if top_up > 0 {
            invoke(
                &system_instruction::transfer(&ctx.accounts.owner.key(), &capsule.key(), top_up),
                &[
                    ctx.accounts.owner.to_account_info(),
                    capsule.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        emit!(CapsuleUploadStarted {
            capsule: capsule.key(),
            capsule_id,
            owner: capsule.owner,
            unlock_at,
            mode,
            format_version,
            expected_payload_len,
            payload_hash,
            expected_title_len,
            expires_at,
        });
        Ok(())
    }

    pub fn write_chunk(ctx: Context<WriteChunk>, offset: u32, data: Vec<u8>) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        validate_uploading(capsule)?;
        require!(!data.is_empty(), CapsuleError::EmptyChunk);
        require!(
            data.len() <= MAX_WRITE_CHUNK_BYTES,
            CapsuleError::ChunkTooLarge
        );
        require!(
            offset == capsule.uploaded_payload_len,
            CapsuleError::UnexpectedOffset
        );
        let new_len = capsule
            .uploaded_payload_len
            .checked_add(u32::try_from(data.len()).map_err(|_| CapsuleError::ArithmeticOverflow)?)
            .ok_or(CapsuleError::ArithmeticOverflow)?;
        require!(
            new_len <= capsule.expected_payload_len,
            CapsuleError::PayloadTooLong
        );

        capsule.payload.extend_from_slice(&data);
        capsule.uploaded_payload_len = new_len;
        capsule.to_account_info().resize(Capsule::space_for(
            new_len as usize,
            capsule.public_title_bytes.len(),
        ))?;
        Ok(())
    }

    pub fn write_title_chunk(
        ctx: Context<WriteTitleChunk>,
        offset: u16,
        data: Vec<u8>,
    ) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        validate_uploading(capsule)?;
        require!(
            capsule.mode == CapsuleMode::Public,
            CapsuleError::PrivateTitleMustBeEmpty
        );
        require!(!data.is_empty(), CapsuleError::EmptyChunk);
        require!(
            data.len() <= MAX_WRITE_CHUNK_BYTES,
            CapsuleError::ChunkTooLarge
        );
        require!(
            offset == capsule.uploaded_title_len,
            CapsuleError::UnexpectedTitleOffset
        );
        let new_len = (capsule.uploaded_title_len as usize)
            .checked_add(data.len())
            .ok_or(CapsuleError::ArithmeticOverflow)?;
        require!(
            new_len <= capsule.expected_title_len as usize,
            CapsuleError::TitleTooLong
        );

        capsule.public_title_bytes.extend_from_slice(&data);
        capsule.uploaded_title_len =
            u16::try_from(new_len).map_err(|_| CapsuleError::ArithmeticOverflow)?;
        capsule.to_account_info().resize(Capsule::space_for(
            capsule.payload.len(),
            capsule.public_title_bytes.len(),
        ))?;
        Ok(())
    }

    pub fn finalize_capsule(ctx: Context<FinalizeCapsule>, args: FinalizeFeeArgs) -> Result<()> {
        let capsule = &mut ctx.accounts.capsule;
        validate_uploading(capsule)?;
        require!(
            capsule.uploaded_payload_len == capsule.expected_payload_len
                && capsule.payload.len() == capsule.expected_payload_len as usize,
            CapsuleError::IncompletePayload
        );
        require!(
            capsule.uploaded_title_len == capsule.expected_title_len
                && capsule.public_title_bytes.len() == capsule.expected_title_len as usize,
            CapsuleError::IncompleteTitle
        );
        validate_title_bytes(capsule.mode, &capsule.public_title_bytes)?;
        require!(
            hash(&capsule.payload).to_bytes() == capsule.payload_hash,
            CapsuleError::PayloadHashMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        require!(capsule.unlock_at > now, CapsuleError::UnlockAlreadyPassed);

        let config = &ctx.accounts.config;
        let policy = &ctx.accounts.fee_policy;
        let protocol_fee = match policy.mode {
            FeeMode::FixedSol => config.protocol_fee_lamports,
            FeeMode::UsdcEquivalentSol => {
                let sol = read_price(
                    &ctx.accounts.sol_price,
                    SOL_PRICE_ACCOUNT,
                    &SOL_FEED_ID,
                    policy,
                    now,
                )?;
                let usdc = read_price(
                    &ctx.accounts.usdc_price,
                    USDC_PRICE_ACCOUNT,
                    &USDC_FEED_ID,
                    policy,
                    now,
                )?;
                usdc_fee_lamports(
                    policy.target_usdc_micros,
                    sol,
                    usdc,
                    policy.max_price_skew_seconds,
                )?
            }
        };
        validate_fee_review(policy, args, now, protocol_fee)?;
        require_keys_eq!(
            ctx.accounts.fee_recipient.key(),
            config.fee_recipient,
            CapsuleError::WrongFeeRecipient
        );
        if protocol_fee > 0 {
            // The same wallet may own the capsule and receive the protocol fee.
            // Keep the transfer CPI so balance checks and fee events still apply.
            invoke(
                &system_instruction::transfer(
                    &ctx.accounts.owner.key(),
                    &config.fee_recipient,
                    protocol_fee,
                ),
                &[
                    ctx.accounts.owner.to_account_info(),
                    ctx.accounts.fee_recipient.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }

        capsule.state = CapsuleState::Final;
        capsule.finalized_at = now;
        emit!(ProtocolFeePaid {
            capsule: capsule.key(),
            owner: capsule.owner,
            recipient: config.fee_recipient,
            lamports: protocol_fee,
            policy_revision: policy.revision,
            target_usdc_micros: if policy.mode == FeeMode::UsdcEquivalentSol {
                policy.target_usdc_micros
            } else {
                0
            },
        });
        emit!(CapsuleFinalized {
            capsule: capsule.key(),
            capsule_id: capsule.capsule_id,
            owner: capsule.owner,
            unlock_at: capsule.unlock_at,
            mode: capsule.mode,
            format_version: capsule.format_version,
            payload_len: capsule.expected_payload_len,
            payload_hash: capsule.payload_hash,
            finalized_at: now,
        });
        Ok(())
    }

    pub fn cancel_upload(ctx: Context<CancelUpload>) -> Result<()> {
        require!(
            ctx.accounts.capsule.state == CapsuleState::Uploading,
            CapsuleError::AlreadyFinalized
        );
        Ok(())
    }

    /// Anyone may clean up an abandoned upload after its deadline. Rent returns to its original owner.
    pub fn reclaim_expired_upload(ctx: Context<ReclaimExpiredUpload>) -> Result<()> {
        let capsule = &ctx.accounts.capsule;
        require!(
            capsule.state == CapsuleState::Uploading,
            CapsuleError::AlreadyFinalized
        );
        require!(
            Clock::get()?.unix_timestamp > capsule.expires_at,
            CapsuleError::UploadNotExpired
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub fee_recipient: Pubkey,
    pub protocol_fee_lamports: u64,
    pub max_payload_size: u32,
    pub min_lock_duration: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigArgs {
    pub fee_recipient: Option<Pubkey>,
    pub protocol_fee_lamports: Option<u64>,
    pub max_payload_size: Option<u32>,
    pub min_lock_duration: Option<i64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CapsuleMode {
    Public,
    Private,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CapsuleState {
    Uploading,
    Final,
}

#[account]
pub struct Config {
    pub schema_version: u8,
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub protocol_fee_lamports: u64,
    pub max_payload_size: u32,
    pub min_lock_duration: i64,
}

impl Config {
    pub const SPACE: usize = 8 + 1 + 32 + 32 + 8 + 4 + 8;
}

#[account]
pub struct Capsule {
    pub schema_version: u8,
    pub owner: Pubkey,
    pub capsule_id: u64,
    pub created_at: i64,
    pub unlock_at: i64,
    pub mode: CapsuleMode,
    pub format_version: u16,
    pub state: CapsuleState,
    pub expected_payload_len: u32,
    pub uploaded_payload_len: u32,
    pub payload_hash: [u8; 32],
    pub expected_title_len: u16,
    pub uploaded_title_len: u16,
    pub public_title_bytes: Vec<u8>,
    pub expires_at: i64,
    pub finalized_at: i64,
    pub payload: Vec<u8>,
}

impl Capsule {
    // Includes the Anchor discriminator and both Borsh Vec length prefixes.
    pub const FIXED_SPACE: usize =
        8 + 1 + 32 + 8 + 8 + 8 + 1 + 2 + 1 + 4 + 4 + 32 + 2 + 2 + 4 + 8 + 8 + 4;

    pub fn space_for(payload_len: usize, title_len: usize) -> usize {
        Self::FIXED_SPACE
            .saturating_add(payload_len)
            .saturating_add(title_len)
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: verified in the handler as the canonical ProgramData account and this admin as upgrade authority.
    #[account(owner = bpf_loader_upgradeable::ID, address = bpf_loader_upgradeable::get_program_data_address(&crate::ID))]
    pub program_data: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [FEE_POLICY_SEED], bump)]
    pub fee_policy: Account<'info, FeePolicy>,
}

#[derive(Accounts)]
pub struct InitializeFeePolicy<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = FeePolicy::SPACE, seeds = [FEE_POLICY_SEED], bump)]
    pub fee_policy: Account<'info, FeePolicy>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFeePolicy<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [FEE_POLICY_SEED], bump)]
    pub fee_policy: Account<'info, FeePolicy>,
}

#[derive(Accounts)]
#[instruction(capsule_id: u64, unlock_at: i64, mode: CapsuleMode, format_version: u16, expected_payload_len: u32, payload_hash: [u8; 32], expected_title_len: u16)]
pub struct BeginCapsule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = owner,
        space = Capsule::space_for(0, 0),
        seeds = [CAPSULE_SEED, owner.key().as_ref(), &capsule_id.to_le_bytes()],
        bump
    )]
    pub capsule: Account<'info, Capsule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WriteChunk<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CAPSULE_SEED, capsule.owner.as_ref(), &capsule.capsule_id.to_le_bytes()], bump, has_one = owner)]
    pub capsule: Account<'info, Capsule>,
}

#[derive(Accounts)]
pub struct WriteTitleChunk<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [CAPSULE_SEED, capsule.owner.as_ref(), &capsule.capsule_id.to_le_bytes()], bump, has_one = owner)]
    pub capsule: Account<'info, Capsule>,
}

#[derive(Accounts)]
pub struct FinalizeCapsule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CAPSULE_SEED, capsule.owner.as_ref(), &capsule.capsule_id.to_le_bytes()], bump, has_one = owner)]
    pub capsule: Account<'info, Capsule>,
    /// CHECK: address is constrained to the fee recipient stored in Config.
    #[account(mut, address = config.fee_recipient)]
    pub fee_recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(seeds = [FEE_POLICY_SEED], bump)]
    pub fee_policy: Account<'info, FeePolicy>,
    /// CHECK: canonical address, owner, full verification and message validated before charging.
    pub sol_price: UncheckedAccount<'info>,
    /// CHECK: canonical address, owner, full verification and message validated before charging.
    pub usdc_price: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelUpload<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, close = owner, seeds = [CAPSULE_SEED, capsule.owner.as_ref(), &capsule.capsule_id.to_le_bytes()], bump, has_one = owner)]
    pub capsule: Account<'info, Capsule>,
}

#[derive(Accounts)]
pub struct ReclaimExpiredUpload<'info> {
    /// CHECK: must equal the owner recorded in the upload PDA; it need not sign.
    #[account(mut, address = capsule.owner)]
    pub owner_destination: UncheckedAccount<'info>,
    #[account(mut, close = owner_destination, seeds = [CAPSULE_SEED, capsule.owner.as_ref(), &capsule.capsule_id.to_le_bytes()], bump)]
    pub capsule: Account<'info, Capsule>,
}

#[event]
pub struct CapsuleUploadStarted {
    pub capsule: Pubkey,
    pub capsule_id: u64,
    pub owner: Pubkey,
    pub unlock_at: i64,
    pub mode: CapsuleMode,
    pub format_version: u16,
    pub expected_payload_len: u32,
    pub payload_hash: [u8; 32],
    pub expected_title_len: u16,
    pub expires_at: i64,
}

#[event]
pub struct CapsuleFinalized {
    pub capsule: Pubkey,
    pub capsule_id: u64,
    pub owner: Pubkey,
    pub unlock_at: i64,
    pub mode: CapsuleMode,
    pub format_version: u16,
    pub payload_len: u32,
    pub payload_hash: [u8; 32],
    pub finalized_at: i64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub protocol_fee_lamports: u64,
    pub max_payload_size: u32,
    pub min_lock_duration: i64,
}

#[event]
pub struct ProtocolFeePaid {
    pub capsule: Pubkey,
    pub owner: Pubkey,
    pub recipient: Pubkey,
    pub lamports: u64,
    pub policy_revision: u64,
    pub target_usdc_micros: u64,
}

fn validate_upgrade_authority(
    program_data: &UncheckedAccount,
    expected_admin: Pubkey,
) -> Result<()> {
    let data = program_data.try_borrow_data()?;
    let mut bytes: &[u8] = &data;
    let state = UpgradeableLoaderState::try_deserialize_unchecked(&mut bytes)
        .map_err(|_| error!(CapsuleError::InvalidProgramData))?;
    match state {
        UpgradeableLoaderState::ProgramData {
            upgrade_authority_address: Some(authority),
            ..
        } => {
            require_keys_eq!(
                authority,
                expected_admin,
                CapsuleError::AdminMustBeUpgradeAuthority
            );
            Ok(())
        }
        UpgradeableLoaderState::ProgramData {
            upgrade_authority_address: None,
            ..
        } => {
            err!(CapsuleError::ProgramIsImmutable)
        }
        _ => err!(CapsuleError::InvalidProgramData),
    }
}

fn validate_payload_size(payload_len: u32, max_payload_size: u32) -> Result<()> {
    require!(
        payload_len > 0 && payload_len <= max_payload_size,
        CapsuleError::InvalidPayloadLength
    );
    require!(
        payload_len <= MAX_PAYLOAD_SIZE,
        CapsuleError::InvalidPayloadLength
    );
    Ok(())
}

fn validate_format_version(mode: CapsuleMode, format_version: u16) -> Result<()> {
    match format_version {
        V1_FORMAT_VERSION => Ok(()),
        V2_FORMAT_VERSION => {
            require!(
                mode == CapsuleMode::Private,
                CapsuleError::Version2RequiresPrivateMode
            );
            Ok(())
        }
        _ => err!(CapsuleError::UnsupportedFormatVersion),
    }
}

fn validate_title_length(mode: CapsuleMode, title_len: usize) -> Result<()> {
    match mode {
        CapsuleMode::Public => require!(
            title_len > 0 && title_len <= MAX_PUBLIC_TITLE_BYTES,
            CapsuleError::InvalidPublicTitleLength
        ),
        CapsuleMode::Private => require!(title_len == 0, CapsuleError::PrivateTitleMustBeEmpty),
    }
    Ok(())
}

fn validate_title_bytes(mode: CapsuleMode, title_bytes: &[u8]) -> Result<()> {
    match mode {
        CapsuleMode::Private => require!(
            title_bytes.is_empty(),
            CapsuleError::PrivateTitleMustBeEmpty
        ),
        CapsuleMode::Public => {
            require!(
                !title_bytes.is_empty() && title_bytes.len() <= MAX_PUBLIC_TITLE_BYTES,
                CapsuleError::InvalidPublicTitleLength
            );
            let title = core::str::from_utf8(title_bytes)
                .map_err(|_| error!(CapsuleError::InvalidTitleEncoding))?;
            require!(!title.trim().is_empty(), CapsuleError::BlankPublicTitle);
            require!(
                title.chars().count() <= MAX_PUBLIC_TITLE_CHARACTERS,
                CapsuleError::TooManyTitleCharacters
            );
        }
    }
    Ok(())
}

fn validate_uploading(capsule: &Capsule) -> Result<()> {
    require!(
        capsule.schema_version == CAPSULE_VERSION,
        CapsuleError::UnsupportedCapsuleVersion
    );
    validate_format_version(capsule.mode, capsule.format_version)?;
    require!(
        capsule.state == CapsuleState::Uploading,
        CapsuleError::AlreadyFinalized
    );
    require!(
        Clock::get()?.unix_timestamp <= capsule.expires_at,
        CapsuleError::UploadExpired
    );
    Ok(())
}

#[error_code]
pub enum CapsuleError {
    #[msg("A required address cannot be the zero public key.")]
    ZeroAddress,
    #[msg("Payload limit must be between 1 and 65,536 bytes.")]
    InvalidPayloadLimit,
    #[msg("Minimum lock duration cannot be negative.")]
    InvalidLockDuration,
    #[msg("Config initialization must be signed by the program upgrade authority.")]
    AdminMustBeUpgradeAuthority,
    #[msg("An immutable program cannot initialize Config through its loader authority.")]
    ProgramIsImmutable,
    #[msg("ProgramData account is malformed or is not the expected loader state.")]
    InvalidProgramData,
    #[msg("Payload length is zero or exceeds the configured maximum.")]
    InvalidPayloadLength,
    #[msg("Only Capsule Open Format V1 and private V2 are accepted.")]
    UnsupportedFormatVersion,
    #[msg("Public title length must be 1 to 2,048 UTF-8 bytes.")]
    InvalidPublicTitleLength,
    #[msg("Private capsules cannot contain a public title.")]
    PrivateTitleMustBeEmpty,
    #[msg("Unlock time must exceed now plus the configured minimum lock duration.")]
    InvalidUnlockTime,
    #[msg("Checked timestamp or length arithmetic overflowed.")]
    ArithmeticOverflow,
    #[msg("Upload expired; begin a new capsule or reclaim this PDA.")]
    UploadExpired,
    #[msg("Chunk must contain at least one byte.")]
    EmptyChunk,
    #[msg("Chunk exceeds the 3,800-byte program limit.")]
    ChunkTooLarge,
    #[msg("Payload chunks must be written at the exact next offset.")]
    UnexpectedOffset,
    #[msg("Title chunks must be written at the exact next offset.")]
    UnexpectedTitleOffset,
    #[msg("Payload chunk would exceed the declared payload length.")]
    PayloadTooLong,
    #[msg("Public title chunk would exceed the declared title length.")]
    TitleTooLong,
    #[msg("Payload is incomplete.")]
    IncompletePayload,
    #[msg("Public title is incomplete.")]
    IncompleteTitle,
    #[msg("Public title bytes are not valid UTF-8.")]
    InvalidTitleEncoding,
    #[msg("Public title must not be blank.")]
    BlankPublicTitle,
    #[msg("Public title exceeds 512 Unicode scalar values.")]
    TooManyTitleCharacters,
    #[msg("Stored payload SHA-256 does not match the declared hash.")]
    PayloadHashMismatch,
    #[msg("Unlock time passed before the upload was finalized.")]
    UnlockAlreadyPassed,
    #[msg("Fee recipient does not match Config.")]
    WrongFeeRecipient,
    // Preserve this legacy error slot so subsequent public error codes stay stable.
    #[msg("Reserved legacy error; same-wallet protocol fee payments are allowed.")]
    OwnerIsFeeRecipient,
    #[msg("Capsule is not in the Uploading state.")]
    AlreadyFinalized,
    #[msg("Upload is not expired yet.")]
    UploadNotExpired,
    #[msg("Capsule account schema version is unsupported.")]
    UnsupportedCapsuleVersion,
    #[msg("Fee policy parameters are invalid.")]
    InvalidFeePolicy,
    #[msg("Price account is not the canonical Pyth Core account or layout.")]
    InvalidOracleAccount,
    #[msg("Price update must have Full verification.")]
    UnverifiedOraclePrice,
    #[msg("Price feed ID differs from the configured feed.")]
    WrongOracleFeed,
    #[msg("Price or exponent is invalid.")]
    InvalidOraclePrice,
    #[msg("Price timestamp is in the future or invalid.")]
    FutureOraclePrice,
    #[msg("Price is too old. Refresh the fee review; no protocol fee was charged.")]
    StaleOraclePrice,
    #[msg("Price confidence interval exceeds policy limits.")]
    UncertainOraclePrice,
    #[msg("Price update times differ beyond policy limits.")]
    OraclePriceSkew,
    #[msg("Fee policy changed after review. Review the fee again.")]
    FeePolicyChanged,
    #[msg("Fee review expired. Review the fee again.")]
    FeeQuoteExpired,
    #[msg("Current protocol fee exceeds the signed SOL limit.")]
    ProtocolFeeCapExceeded,
    #[msg("Capsule Open Format V2 requires private mode.")]
    Version2RequiresPrivateMode,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capsule_space_matches_maximum_public_account() {
        assert_eq!(Capsule::FIXED_SPACE, 137);
        assert_eq!(
            Capsule::space_for(MAX_PAYLOAD_SIZE as usize, MAX_PUBLIC_TITLE_BYTES),
            67_721
        );
    }

    #[test]
    fn public_title_counts_unicode_scalars_and_private_title_is_empty() {
        assert!(validate_title_length(CapsuleMode::Public, 2_048).is_ok());
        assert!(validate_title_length(CapsuleMode::Private, 0).is_ok());
        assert!(validate_title_length(CapsuleMode::Private, 1).is_err());
        assert!(validate_title_bytes(CapsuleMode::Public, "界".as_bytes()).is_ok());
        assert!(validate_title_bytes(CapsuleMode::Public, " ".as_bytes()).is_err());
        assert!(validate_title_bytes(CapsuleMode::Public, &[0xff]).is_err());
        assert!(validate_title_bytes(CapsuleMode::Public, "🙂".repeat(512).as_bytes()).is_ok());
        assert!(validate_title_bytes(CapsuleMode::Public, "🙂".repeat(513).as_bytes()).is_err());
    }

    #[test]
    fn payload_limit_is_bounded_by_config_and_product_ceiling() {
        assert!(validate_payload_size(1, MAX_PAYLOAD_SIZE).is_ok());
        assert!(validate_payload_size(MAX_PAYLOAD_SIZE, MAX_PAYLOAD_SIZE).is_ok());
        assert!(validate_payload_size(0, MAX_PAYLOAD_SIZE).is_err());
        assert!(validate_payload_size(MAX_PAYLOAD_SIZE + 1, MAX_PAYLOAD_SIZE + 1).is_err());
        assert!(validate_payload_size(MAX_PAYLOAD_SIZE, 16_384).is_err());
    }

    #[test]
    fn format_version_allowlist_preserves_v1_and_requires_private_v2() {
        assert!(validate_format_version(CapsuleMode::Public, V1_FORMAT_VERSION).is_ok());
        assert!(validate_format_version(CapsuleMode::Private, V1_FORMAT_VERSION).is_ok());
        assert!(validate_format_version(CapsuleMode::Private, V2_FORMAT_VERSION).is_ok());
        assert!(validate_format_version(CapsuleMode::Public, V2_FORMAT_VERSION).is_err());
        assert!(validate_format_version(CapsuleMode::Private, 0).is_err());
        assert!(validate_format_version(CapsuleMode::Private, 3).is_err());
    }

    #[test]
    fn capsule_pda_is_namespaced_by_owner_and_user_supplied_id() {
        let owner_a = Pubkey::new_unique();
        let owner_b = Pubkey::new_unique();
        let address = |owner: Pubkey, id: u64| {
            Pubkey::find_program_address(
                &[CAPSULE_SEED, owner.as_ref(), &id.to_le_bytes()],
                &crate::ID,
            )
            .0
        };
        assert_eq!(address(owner_a, 7), address(owner_a, 7));
        assert_ne!(address(owner_a, 7), address(owner_b, 7));
        assert_ne!(address(owner_a, 7), address(owner_a, 8));
    }
}
