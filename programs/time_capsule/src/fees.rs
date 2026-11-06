use crate::CapsuleError;
use anchor_lang::prelude::*;

pub const FEE_POLICY_SEED: &[u8] = b"fee-policy-v1";
pub const MAX_ORACLE_FUTURE_SECONDS: i64 = 5;
pub const PYTH_RECEIVER: Pubkey = pubkey!("rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp");
pub const SOL_PRICE_ACCOUNT: Pubkey = pubkey!("7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE");
pub const USDC_PRICE_ACCOUNT: Pubkey = pubkey!("6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT");
pub const SOL_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];
pub const USDC_FEED_ID: [u8; 32] = [
    0xea, 0xa0, 0x20, 0xc6, 0x1c, 0xc4, 0x79, 0x71, 0x28, 0x13, 0x46, 0x1c, 0xe1, 0x53, 0x89, 0x4a,
    0x96, 0xa6, 0xc0, 0x0b, 0x21, 0xed, 0x0c, 0xfc, 0x27, 0x98, 0xd1, 0xf9, 0xa9, 0xe9, 0xc9, 0x4a,
];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum FeeMode {
    FixedSol,
    UsdcEquivalentSol,
}

#[account]
pub struct FeePolicy {
    pub schema_version: u8,
    pub mode: FeeMode,
    pub revision: u64,
    pub target_usdc_micros: u64,
    pub max_price_age_seconds: u32,
    pub max_confidence_bps: u16,
    pub max_price_skew_seconds: u32,
}

impl FeePolicy {
    pub const SPACE: usize = 8 + 1 + 1 + 8 + 8 + 4 + 2 + 4;

    pub fn apply(&mut self, args: FeePolicyArgs) -> Result<()> {
        require!(
            args.target_usdc_micros <= 1_000_000_000_000,
            CapsuleError::InvalidFeePolicy
        );
        require!(
            args.mode == FeeMode::FixedSol || args.target_usdc_micros > 0,
            CapsuleError::InvalidFeePolicy
        );
        require!(
            args.max_price_age_seconds > 0 && args.max_price_age_seconds <= 3_600,
            CapsuleError::InvalidFeePolicy
        );
        require!(
            args.max_confidence_bps > 0 && args.max_confidence_bps <= 1_000,
            CapsuleError::InvalidFeePolicy
        );
        require!(
            args.max_price_skew_seconds > 0
                && args.max_price_skew_seconds <= args.max_price_age_seconds,
            CapsuleError::InvalidFeePolicy
        );
        self.schema_version = 1;
        self.mode = args.mode;
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(CapsuleError::ArithmeticOverflow)?;
        self.target_usdc_micros = args.target_usdc_micros;
        self.max_price_age_seconds = args.max_price_age_seconds;
        self.max_confidence_bps = args.max_confidence_bps;
        self.max_price_skew_seconds = args.max_price_skew_seconds;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct FeePolicyArgs {
    pub mode: FeeMode,
    pub target_usdc_micros: u64,
    pub max_price_age_seconds: u32,
    pub max_confidence_bps: u16,
    pub max_price_skew_seconds: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct FinalizeFeeArgs {
    pub max_protocol_fee_lamports: u64,
    pub expected_policy_revision: u64,
    pub valid_until: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct OraclePrice {
    pub price: i64,
    pub exponent: i32,
    pub publish_time: i64,
}

// Pinned PriceUpdateV2 layout from pyth-solana-receiver-sdk: Full verification
// has a one-byte enum, so its message begins at byte 41. Reject Partial outright.
// Avoid pulling an incompatible Anchor runtime into this Anchor 1.2.1 program.
pub fn parse_price(
    data: &[u8],
    feed_id: &[u8; 32],
    policy: &FeePolicy,
    now: i64,
) -> Result<OraclePrice> {
    require!(
        data.len() == 134 && data[..8] == [34, 241, 35, 99, 157, 126, 244, 205],
        CapsuleError::InvalidOracleAccount
    );
    require!(data[40] == 1, CapsuleError::UnverifiedOraclePrice);
    require!(data[41..73] == *feed_id, CapsuleError::WrongOracleFeed);
    let price = i64::from_le_bytes(data[73..81].try_into().unwrap());
    let confidence = u64::from_le_bytes(data[81..89].try_into().unwrap());
    let exponent = i32::from_le_bytes(data[89..93].try_into().unwrap());
    let publish_time = i64::from_le_bytes(data[93..101].try_into().unwrap());
    require!(
        price > 0 && (-12..=0).contains(&exponent),
        CapsuleError::InvalidOraclePrice
    );
    require!(
        publish_time > 0
            && publish_time
                <= now
                    .checked_add(MAX_ORACLE_FUTURE_SECONDS)
                    .ok_or(CapsuleError::ArithmeticOverflow)?,
        CapsuleError::FutureOraclePrice
    );
    require!(
        now.checked_sub(publish_time)
            .ok_or(CapsuleError::ArithmeticOverflow)?
            <= i64::from(policy.max_price_age_seconds),
        CapsuleError::StaleOraclePrice
    );
    require!(
        u128::from(confidence) * 10_000 <= (price as u128) * u128::from(policy.max_confidence_bps),
        CapsuleError::UncertainOraclePrice
    );
    Ok(OraclePrice {
        price,
        exponent,
        publish_time,
    })
}

pub fn read_price(
    account: &UncheckedAccount,
    expected_account: Pubkey,
    feed_id: &[u8; 32],
    policy: &FeePolicy,
    now: i64,
) -> Result<OraclePrice> {
    require_keys_eq!(
        account.key(),
        expected_account,
        CapsuleError::InvalidOracleAccount
    );
    require_keys_eq!(
        *account.owner,
        PYTH_RECEIVER,
        CapsuleError::InvalidOracleAccount
    );
    require!(!account.executable, CapsuleError::InvalidOracleAccount);
    parse_price(&account.try_borrow_data()?, feed_id, policy, now)
}

pub fn usdc_fee_lamports(
    target_usdc_micros: u64,
    sol: OraclePrice,
    usdc: OraclePrice,
    max_skew_seconds: u32,
) -> Result<u64> {
    require!(
        sol.price > 0
            && usdc.price > 0
            && (-12..=0).contains(&sol.exponent)
            && (-12..=0).contains(&usdc.exponent),
        CapsuleError::InvalidOraclePrice
    );
    require!(
        sol.publish_time.abs_diff(usdc.publish_time) <= u64::from(max_skew_seconds),
        CapsuleError::OraclePriceSkew
    );
    let exponent = sol.exponent.min(usdc.exponent);
    let normalized = |price: OraclePrice| -> Result<u128> {
        (price.price as u128)
            .checked_mul(10u128.pow((price.exponent - exponent) as u32))
            .ok_or_else(|| error!(CapsuleError::ArithmeticOverflow))
    };
    let numerator = u128::from(target_usdc_micros)
        .checked_mul(1_000_000_000)
        .and_then(|value| value.checked_mul(normalized(usdc).ok()?))
        .ok_or(CapsuleError::ArithmeticOverflow)?;
    let denominator = normalized(sol)?
        .checked_mul(1_000_000)
        .ok_or(CapsuleError::ArithmeticOverflow)?;
    let amount = numerator / denominator + u128::from(numerator % denominator != 0);
    u64::try_from(amount).map_err(|_| error!(CapsuleError::ArithmeticOverflow))
}

pub fn validate_fee_review(
    policy: &FeePolicy,
    args: FinalizeFeeArgs,
    now: i64,
    fee: u64,
) -> Result<()> {
    require!(
        policy.schema_version == 1 && args.expected_policy_revision == policy.revision,
        CapsuleError::FeePolicyChanged
    );
    require!(args.valid_until >= now, CapsuleError::FeeQuoteExpired);
    require!(
        fee <= args.max_protocol_fee_lamports,
        CapsuleError::ProtocolFeeCapExceeded
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> FeePolicy {
        FeePolicy {
            schema_version: 1,
            mode: FeeMode::UsdcEquivalentSol,
            revision: 1,
            target_usdc_micros: 1_000_000,
            max_price_age_seconds: 120,
            max_confidence_bps: 100,
            max_price_skew_seconds: 120,
        }
    }

    fn price_bytes(feed: [u8; 32], price: i64, exponent: i32, time: i64) -> Vec<u8> {
        let mut bytes = vec![0; 134];
        bytes[..8].copy_from_slice(&[34, 241, 35, 99, 157, 126, 244, 205]);
        bytes[40] = 1;
        bytes[41..73].copy_from_slice(&feed);
        bytes[73..81].copy_from_slice(&price.to_le_bytes());
        bytes[81..89].copy_from_slice(&1u64.to_le_bytes());
        bytes[89..93].copy_from_slice(&exponent.to_le_bytes());
        bytes[93..101].copy_from_slice(&time.to_le_bytes());
        bytes
    }

    #[test]
    fn core_accounts_are_canonical_shard_zero_pdas() {
        let program = pubkey!("pyt2F414BA6dPttK6RddPZUdHfapoBN24GL5wbrPCou");
        for (feed, expected) in [
            (SOL_FEED_ID, SOL_PRICE_ACCOUNT),
            (USDC_FEED_ID, USDC_PRICE_ACCOUNT),
        ] {
            assert_eq!(
                Pubkey::find_program_address(&[&0u16.to_le_bytes(), &feed], &program).0,
                expected
            );
        }
    }

    #[test]
    fn strict_layout_and_verification_are_required() {
        let data = price_bytes(SOL_FEED_ID, 10_000_000_000, -8, 1_000);
        assert!(parse_price(&data, &SOL_FEED_ID, &policy(), 1_001).is_ok());
        for length in [0, 8, 40, 100, 133] {
            assert!(parse_price(&data[..length], &SOL_FEED_ID, &policy(), 1_001).is_err());
        }
        for index in [0, 40, 41] {
            let mut bad = data.clone();
            bad[index] ^= 1;
            assert!(parse_price(&bad, &SOL_FEED_ID, &policy(), 1_001).is_err());
        }
        assert!(parse_price(&data, &USDC_FEED_ID, &policy(), 1_001).is_err());
    }

    #[test]
    fn price_age_and_confidence_boundaries_fail_closed() {
        let data = price_bytes(SOL_FEED_ID, 10_000_000_000, -8, 1_000);
        assert!(parse_price(&data, &SOL_FEED_ID, &policy(), 1_120).is_ok());
        assert!(parse_price(&data, &SOL_FEED_ID, &policy(), 1_121).is_err());
        assert!(parse_price(&data, &SOL_FEED_ID, &policy(), 995).is_ok());
        assert!(parse_price(&data, &SOL_FEED_ID, &policy(), 994).is_err());
        let mut uncertain = data.clone();
        uncertain[81..89].copy_from_slice(&100_000_001u64.to_le_bytes());
        assert!(parse_price(&uncertain, &SOL_FEED_ID, &policy(), 1_001).is_err());
        for (price, exponent) in [(0, -8), (-1, -8), (1, -13), (1, 1)] {
            assert!(parse_price(
                &price_bytes(SOL_FEED_ID, price, exponent, 1_000),
                &SOL_FEED_ID,
                &policy(),
                1_001
            )
            .is_err());
        }
        let mut devnet = policy();
        devnet.max_price_age_seconds = 600;
        assert!(parse_price(&data, &SOL_FEED_ID, &devnet, 1_300).is_ok());
    }

    #[test]
    fn usdc_ratio_rounds_up_and_handles_different_exponents() {
        let sol = OraclePrice {
            price: 10_000_000_000,
            exponent: -8,
            publish_time: 1_000,
        };
        let usdc = OraclePrice {
            price: 100_000_000,
            exponent: -8,
            publish_time: 1_000,
        };
        assert_eq!(
            usdc_fee_lamports(1_000_000, sol, usdc, 120).unwrap(),
            10_000_000
        );
        assert_eq!(usdc_fee_lamports(10, sol, usdc, 120).unwrap(), 100);
        let usdc = OraclePrice {
            price: 1,
            exponent: 0,
            ..usdc
        };
        assert_eq!(
            usdc_fee_lamports(1_000_000, sol, usdc, 120).unwrap(),
            10_000_000
        );
        let sol = OraclePrice {
            price: 10483372560,
            exponent: -8,
            ..sol
        };
        let usdc = OraclePrice {
            price: 99991634,
            exponent: -8,
            ..usdc
        };
        assert_eq!(usdc_fee_lamports(10, sol, usdc, 120).unwrap(), 96);
        assert_eq!(
            usdc_fee_lamports(1_000_000, sol, usdc, 120).unwrap(),
            9_538_117
        );
    }

    #[test]
    fn skew_overflow_and_invalid_prices_are_rejected() {
        let sol = OraclePrice {
            price: 1,
            exponent: -12,
            publish_time: 1_000,
        };
        let usdc = OraclePrice {
            price: i64::MAX,
            exponent: 0,
            publish_time: 1_000,
        };
        assert!(usdc_fee_lamports(u64::MAX, sol, usdc, 120).is_err());
        assert!(usdc_fee_lamports(
            1,
            sol,
            OraclePrice {
                publish_time: 1_121,
                ..usdc
            },
            120
        )
        .is_err());
        assert!(usdc_fee_lamports(1, OraclePrice { price: 0, ..sol }, usdc, 120).is_err());
    }

    #[test]
    fn fee_caps_deadlines_and_revisions_are_signed_constraints() {
        let args = FinalizeFeeArgs {
            max_protocol_fee_lamports: 100,
            expected_policy_revision: 1,
            valid_until: 1_100,
        };
        assert!(validate_fee_review(&policy(), args, 1_100, 100).is_ok());
        assert!(validate_fee_review(&policy(), args, 1_101, 100).is_err());
        assert!(validate_fee_review(&policy(), args, 1_000, 101).is_err());
        assert!(validate_fee_review(
            &policy(),
            FinalizeFeeArgs {
                expected_policy_revision: 2,
                ..args
            },
            1_000,
            100
        )
        .is_err());
    }

    #[test]
    fn policy_updates_are_bounded_and_preserve_the_base_account_layout() {
        assert_eq!(crate::Config::SPACE, 93);
        assert_eq!(FeePolicy::SPACE, 36);
        let mut p = policy();
        let args = FeePolicyArgs {
            mode: FeeMode::UsdcEquivalentSol,
            target_usdc_micros: 10,
            max_price_age_seconds: 600,
            max_confidence_bps: 100,
            max_price_skew_seconds: 600,
        };
        p.apply(args.clone()).unwrap();
        assert_eq!(p.revision, 2);
        assert_eq!(p.target_usdc_micros, 10);
        assert!(p
            .apply(FeePolicyArgs {
                target_usdc_micros: 0,
                ..args.clone()
            })
            .is_err());
        assert!(p
            .apply(FeePolicyArgs {
                max_price_age_seconds: 0,
                ..args.clone()
            })
            .is_err());
        assert!(p
            .apply(FeePolicyArgs {
                max_confidence_bps: 0,
                ..args.clone()
            })
            .is_err());
        assert!(p
            .apply(FeePolicyArgs {
                max_price_skew_seconds: 601,
                ..args.clone()
            })
            .is_err());
        let mut serialized = Vec::new();
        p.try_serialize(&mut serialized).unwrap();
        assert_eq!(serialized.len(), FeePolicy::SPACE);
        assert_eq!(&serialized[..8], &[98, 183, 86, 160, 232, 222, 82, 45]);
    }
}
