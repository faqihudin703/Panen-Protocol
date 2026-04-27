//! # Panen Protocol
//!
//! On-chain receivables financing for Indonesian palm oil smallholder farmers.
//!
//! ## Overview
//!
//! Cooperatives receive 80% of invoice value upfront in USDC from the advance pool.
//! The mill co-signs the delivery receipt to confirm TBS was received.
//! An off-chain AI classifier verifies invoice authenticity before disbursement.
//! The cooperative repays the advance + 3.5% protocol fee within 75 days.
//!
//! ## Account Architecture
//!
//! ```
//! AdvancePool (pool authority)
//!   └── Vault (SPL token account, pool PDA as authority)
//!   └── Treasury (pool authority ATA, receives 0.5% protocol fee)
//!   └── oracle_authority: Pubkey (separate keypair for rate updates)
//!
//! RateOracle (oracle authority)
//!   └── idr_per_usdc: IDR/USDC × 10_000 (updated daily from Bank Indonesia)
//!
//! AgreementAccount (mill + koperasi pair)
//!   └── receipt_nonce: auto-increment per receipt
//!
//! DeliveryReceipt (per TBS delivery)
//!   └── Status: PendingMillSign → ReadyToAdvance → AdvanceActive → Settled
//!
//! KoperasiAdvance (per advance disbursement)
//!   └── Closed on settle → rent returned to koperasi
//! ```
//!
//! ## Fee Structure
//!
//! - Advance rate:   80% of invoice value (ADVANCE_RATE_BPS = 8_000)
//! - Total fee:      3.5% of advance amount (SERVICE_FEE_BPS = 350)
//!   - LP yield:     3.0% → vault (LP_YIELD_BPS = 300)
//!   - Protocol fee: 0.5% → treasury (PROTOCOL_FEE_BPS = 50)
//!
//! ## Program ID
//!
//! `Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj` (Solana Devnet)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Co2fcVRVsGM4ZNGd5UMFVxdAvoRcpqoSpCvgdJzEUTjj");

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

pub const ADVANCE_RATE_BPS: u64          = 8_000;
pub const SERVICE_FEE_BPS: u128          = 350;
pub const PROTOCOL_FEE_BPS: u128         = 50;
pub const LP_YIELD_BPS: u128             = 300;
pub const FRAUD_REJECT_THRESHOLD: u8     = 70;
pub const SETTLEMENT_WINDOW_SECS: i64    = 75 * 24 * 60 * 60;
pub const FALLBACK_IDR_PER_USDC_RAW: u64 = 160_000_000;
pub const ORACLE_MAX_STALENESS_SECS: i64 = 48 * 60 * 60;
pub const USDC_MULTIPLIER: u64           = 1_000_000;

pub const GPS_LAT_MIN: i64 = -11_000_000;
pub const GPS_LAT_MAX: i64 =   6_000_000;
pub const GPS_LON_MIN: i64 =  95_000_000;
pub const GPS_LON_MAX: i64 = 141_000_000;

pub const RATE_MIN_RAW: u64 = 100_000_000;
pub const RATE_MAX_RAW: u64 = 1_000_000_000;

pub const SEED_AGREEMENT:   &[u8] = b"agreement";
pub const SEED_RECEIPT:     &[u8] = b"receipt";
pub const SEED_POOL:        &[u8] = b"pool";
pub const SEED_VAULT:       &[u8] = b"vault";
pub const SEED_ADVANCE:     &[u8] = b"advance";
pub const SEED_RATE_ORACLE: &[u8] = b"rate_oracle";

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

#[error_code]
pub enum PanenError {
    #[msg("Agreement is not active")]
    AgreementInactive,
    #[msg("Agreement is still pending mill acceptance")]
    AgreementPendingAcceptance,
    #[msg("Agreement has already been accepted by mill")]
    AgreementAlreadyAccepted,
    #[msg("Only koperasi can cancel a proposal before mill accepts")]
    UnauthorizedCancellation,
    #[msg("Cannot cancel — mill has already accepted this agreement")]
    CannotCancelAcceptedAgreement,
    #[msg("Weight cannot be zero")]
    ZeroWeight,
    #[msg("Price per kg cannot be zero")]
    ZeroPrice,
    #[msg("Invoice value does not equal weight_kg x price_per_kg")]
    InvoiceValueMismatch,
    #[msg("GPS coordinates outside valid Indonesian region bounds")]
    InvalidGpsCoordinates,
    #[msg("Signer is not the mill registered in the agreement")]
    UnauthorizedMill,
    #[msg("Mill has already co-signed this receipt")]
    AlreadyMillSigned,
    #[msg("Receipt was rejected by AI classifier — score >= 70")]
    ReceiptRejected,
    #[msg("Signer is not the koperasi registered in the agreement")]
    UnauthorizedKoperasi,
    #[msg("Receipt has not been co-signed by mill yet")]
    ReceiptNotMillSigned,
    #[msg("Receipt is not in ReadyToAdvance status")]
    ReceiptNotReadyToAdvance,
    #[msg("Advance amount is zero")]
    ZeroAdvanceAmount,
    #[msg("Insufficient USDC in advance pool vault")]
    InsufficientPoolFunds,
    #[msg("Koperasi ATA mint mismatch or wrong owner")]
    InvalidKoperasiAta,
    #[msg("Koperasi ATA cannot be the same as vault")]
    KoperasiAtaCannotBeVault,
    #[msg("Receipt is not in AdvanceActive status")]
    ReceiptNotActive,
    #[msg("Advance has already been settled")]
    AlreadySettled,
    #[msg("Only the submitting koperasi can settle this advance")]
    UnauthorizedSettler,
    #[msg("Koperasi ATA has insufficient USDC to repay")]
    InsufficientRepaymentBalance,
    #[msg("Circular repayment: koperasi ATA cannot equal vault")]
    CircularRepayment,
    #[msg("Treasury cannot be the same as vault")]
    TreasuryCannotBeVault,
    #[msg("Signer is not the pool authority")]
    UnauthorizedPoolAuthority,
    #[msg("Token account mint does not match pool mint")]
    InvalidMint,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Rate oracle is not active")]
    OracleNotActive,
    #[msg("Rate oracle IDR/USDC rate is out of valid range")]
    OracleZeroRate,
    #[msg("Signer is not the rate oracle authority")]
    UnauthorizedOracleAuthority,
    #[msg("Rate oracle authority does not match pool oracle_authority")]
    OracleAuthorityMismatch,
    #[msg("Receipt cannot be closed in current status")]
    ReceiptNotCloseable,
    #[msg("Advance must be settled before closing")]
    AdvanceNotSettled,
    #[msg("Withdraw amount exceeds available pool funds")]
    WithdrawExceedsAvailable,
    #[msg("Withdraw amount cannot be zero")]
    ZeroWithdrawAmount,
    #[msg("Receipt cancellation requires both koperasi and mill to agree")]
    CancellationRequiresBothParties,
    #[msg("Receipt is already cancelled")]
    ReceiptAlreadyCancelled,
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum ReceiptStatus {
    PendingMillSign,
    ReadyToAdvance,
    AdvanceActive,
    Settled,
    Rejected,
    Cancelled,
}
impl Default for ReceiptStatus {
    fn default() -> Self { ReceiptStatus::PendingMillSign }
}

/// Seeds: [b"agreement", mill, koperasi] — LEN: 154
#[account]
pub struct AgreementAccount {
    pub mill:          Pubkey,
    pub koperasi:      Pubkey,
    pub active:        bool,
    pub created_at:    i64,
    pub receipt_nonce: u64,
    pub bump:          u8,
    pub _reserved:     [u8; 64],
}
impl AgreementAccount {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1 + 64;
}
impl Default for AgreementAccount {
    fn default() -> Self {
        Self {
            mill: Pubkey::default(), koperasi: Pubkey::default(),
            active: false, created_at: 0, receipt_nonce: 0,
            bump: 0, _reserved: [0u8; 64],
        }
    }
}

/// Seeds: [b"receipt", agreement, nonce_snapshot.to_le_bytes()] — LEN: 229
#[account]
pub struct DeliveryReceipt {
    pub agreement:            Pubkey,
    pub koperasi:             Pubkey,
    pub weight_kg:            u64,
    pub price_per_kg:         u64,
    pub invoice_value_idr:    u64,
    pub nonce_snapshot:       u64,
    pub invoice_hash:         [u8; 32],
    pub gps_lat:              i64,
    pub gps_lon:              i64,
    pub fraud_score:          u8,
    pub mill_signed:          bool,
    pub created_at:           i64,
    pub status:               ReceiptStatus,
    pub bump:                 u8,
    pub cancel_requested_kop: bool,
    pub _reserved:            [u8; 64],
}
impl DeliveryReceipt {
    pub const LEN: usize = 8+32+32+8+8+8+8+32+8+8+1+1+8+1+1+1+64;
}

/// Seeds: [b"pool", authority] — LEN: 222 (TIDAK BERUBAH)

#[account]
pub struct AdvancePool {
    pub authority:        Pubkey,
    pub mint:             Pubkey,
    pub vault:            Pubkey,
    pub lp_yield_bps:     u16,
    pub protocol_fee_bps: u16,
    pub treasury:         Pubkey,
    pub total_deposited:  u64,
    pub total_advanced:   u64,
    pub bump:             u8,
    pub vault_bump:       u8,
    /// Authority yang berhak push rate ke RateOracle.
    /// Di-set saat initialize_pool, bisa diupdate via set_oracle_authority.
    pub oracle_authority: Pubkey,
    pub _reserved:        [u8; 32],
}
impl AdvancePool {
    pub const LEN: usize = 8+32+32+32+2+2+32+8+8+1+1+32+32; // 222

    pub fn available(&self, vault_balance: u64) -> u64 {
        vault_balance.saturating_sub(self.total_advanced)
    }

}

/// Seeds: [b"advance", receipt] — LEN: 180
#[account]
pub struct KoperasiAdvance {
    pub receipt:          Pubkey,
    pub pool:             Pubkey,
    pub koperasi:         Pubkey,
    pub advance_amount:   u64,
    pub disbursed_at:     i64,
    pub due_at:           i64,
    pub idr_per_usdc_raw: u64,
    pub settled:          bool,
    pub settled_at:       i64,
    pub bump:             u8,
    pub _reserved:        [u8; 32],
}
impl KoperasiAdvance {
    pub const LEN: usize = 8+32+32+32+8+8+8+8+1+8+1+32;
}

/// Seeds: [b"rate_oracle", authority] — LEN: 90
#[account]
pub struct RateOracle {
    pub authority:    Pubkey,
    pub idr_per_usdc: u64,
    pub last_updated: i64,
    pub is_active:    bool,
    pub bump:         u8,
    pub _reserved:    [u8; 32],
}
impl RateOracle {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 1 + 32;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXTS
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeRateOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init, payer = authority, space = RateOracle::LEN,
        seeds = [SEED_RATE_ORACLE, authority.key().as_ref()],
        bump,
    )]
    pub rate_oracle: Account<'info, RateOracle>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRate<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_RATE_ORACLE, authority.key().as_ref()],
        bump = rate_oracle.bump,
        constraint = rate_oracle.authority == authority.key()
            @ PanenError::UnauthorizedOracleAuthority,
    )]
    pub rate_oracle: Account<'info, RateOracle>,
}

#[derive(Accounts)]
#[instruction(proposed_mill: Pubkey)]
pub struct ProposeAgreement<'info> {
    #[account(mut)]
    pub koperasi: Signer<'info>,
    #[account(
        init, payer = koperasi, space = AgreementAccount::LEN,
        seeds = [SEED_AGREEMENT, proposed_mill.as_ref(), koperasi.key().as_ref()],
        bump,
    )]
    pub agreement: Account<'info, AgreementAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    #[account(mut)] // mut: menerima rent dari close = koperasi
    pub koperasi: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, agreement.mill.as_ref(), koperasi.key().as_ref()],
        bump = agreement.bump,
        constraint = agreement.koperasi == koperasi.key() @ PanenError::UnauthorizedCancellation,
        constraint = !agreement.active                    @ PanenError::CannotCancelAcceptedAgreement,
        close = koperasi,
    )]
    pub agreement: Account<'info, AgreementAccount>,
}

#[derive(Accounts)]
pub struct AcceptAgreement<'info> {
    pub mill: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, mill.key().as_ref(), agreement.koperasi.as_ref()],
        bump = agreement.bump,
        constraint = agreement.mill == mill.key()  @ PanenError::UnauthorizedMill,
        constraint = !agreement.active             @ PanenError::AgreementAlreadyAccepted,
    )]
    pub agreement: Account<'info, AgreementAccount>,
}

#[derive(Accounts)]
pub struct DeactivateAgreement<'info> {
    #[account(
        constraint = (
            signer.key() == agreement.koperasi ||
            signer.key() == agreement.mill
        ) @ PanenError::UnauthorizedKoperasi,
    )]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, agreement.mill.as_ref(), agreement.koperasi.as_ref()],
        bump = agreement.bump,
        close = koperasi_refund,
    )]
    pub agreement: Account<'info, AgreementAccount>,
    /// CHECK: koperasi menerima rent refund
    #[account(
        mut,
        constraint = koperasi_refund.key() == agreement.koperasi
            @ PanenError::UnauthorizedKoperasi,
    )]
    pub koperasi_refund: SystemAccount<'info>,
}


/// Update oracle authority. Only callable by pool authority.
/// Use this to rotate the oracle keypair without redeploying.
#[derive(Accounts)]
pub struct SetOracleAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_POOL, authority.key().as_ref()],
        bump = pool.bump,
        has_one = authority @ PanenError::UnauthorizedPoolAuthority,
    )]
    pub pool: Account<'info, AdvancePool>,
}

#[derive(Accounts)]
#[instruction(oracle_authority: Pubkey)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init, payer = authority, space = AdvancePool::LEN,
        seeds = [SEED_POOL, authority.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, AdvancePool>,
    #[account(
        init, payer = authority,
        token::mint      = mint,
        token::authority = pool,
        seeds = [SEED_VAULT, pool.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        constraint = treasury.mint  == mint.key()   @ PanenError::InvalidMint,
        constraint = treasury.key() != vault.key()  @ PanenError::TreasuryCannotBeVault,
    )]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_POOL, authority.key().as_ref()],
        bump = pool.bump,
        has_one = authority @ PanenError::UnauthorizedPoolAuthority,
        has_one = vault     @ PanenError::UnauthorizedPoolAuthority,
    )]
    pub pool: Account<'info, AdvancePool>,
    #[account(
        mut,
        seeds = [SEED_VAULT, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_ata.owner == authority.key() @ PanenError::UnauthorizedPoolAuthority,
        constraint = authority_ata.mint  == pool.mint       @ PanenError::UnauthorizedPoolAuthority,
    )]
    pub authority_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_POOL, authority.key().as_ref()],
        bump = pool.bump,
        has_one = authority @ PanenError::UnauthorizedPoolAuthority,
        has_one = vault     @ PanenError::UnauthorizedPoolAuthority,
    )]
    pub pool: Account<'info, AdvancePool>,
    #[account(
        mut,
        seeds = [SEED_VAULT, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_ata.owner == authority.key() @ PanenError::UnauthorizedPoolAuthority,
        constraint = authority_ata.mint  == pool.mint       @ PanenError::UnauthorizedPoolAuthority,
        constraint = authority_ata.key() != vault.key()     @ PanenError::CircularRepayment,
    )]
    pub authority_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SubmitReceiptParams {
    pub weight_kg:         u64,
    pub price_per_kg:      u64,
    pub invoice_value_idr: u64,
    pub invoice_hash:      [u8; 32],
    pub gps_lat:           i64,
    pub gps_lon:           i64,
    pub fraud_score:       u8,
}

#[derive(Accounts)]
#[instruction(params: SubmitReceiptParams)]
pub struct SubmitDeliveryReceipt<'info> {
    #[account(mut)]
    pub koperasi: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_AGREEMENT, agreement.mill.as_ref(), koperasi.key().as_ref()],
        bump = agreement.bump,
        constraint = agreement.active                      @ PanenError::AgreementInactive,
        constraint = agreement.koperasi == koperasi.key() @ PanenError::UnauthorizedKoperasi,
    )]
    pub agreement: Account<'info, AgreementAccount>,
    #[account(
        init, payer = koperasi, space = DeliveryReceipt::LEN,
        seeds = [
            SEED_RECEIPT,
            agreement.key().as_ref(),
            &agreement.receipt_nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub receipt: Account<'info, DeliveryReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MillCosignReceipt<'info> {
    pub mill: Signer<'info>,
    #[account(
        seeds = [SEED_AGREEMENT, mill.key().as_ref(), agreement.koperasi.as_ref()],
        bump = agreement.bump,
        constraint = agreement.active             @ PanenError::AgreementInactive,
        constraint = agreement.mill == mill.key() @ PanenError::UnauthorizedMill,
    )]
    pub agreement: Account<'info, AgreementAccount>,
    #[account(
        mut,
        seeds = [
            SEED_RECEIPT,
            agreement.key().as_ref(),
            &receipt.nonce_snapshot.to_le_bytes(),
        ],
        bump = receipt.bump,
        constraint = receipt.agreement == agreement.key()             @ PanenError::UnauthorizedMill,
        constraint = receipt.status != ReceiptStatus::Rejected        @ PanenError::ReceiptRejected,
        constraint = receipt.status != ReceiptStatus::Cancelled       @ PanenError::ReceiptAlreadyCancelled,
        constraint = !receipt.mill_signed                             @ PanenError::AlreadyMillSigned,
        constraint = receipt.status == ReceiptStatus::PendingMillSign @ PanenError::AlreadyMillSigned,
    )]
    pub receipt: Account<'info, DeliveryReceipt>,
}

#[derive(Accounts)]
pub struct RequestCancelReceipt<'info> {
    pub koperasi: Signer<'info>,
    #[account(
        seeds = [SEED_AGREEMENT, agreement.mill.as_ref(), koperasi.key().as_ref()],
        bump = agreement.bump,
        constraint = agreement.koperasi == koperasi.key() @ PanenError::UnauthorizedKoperasi,
    )]
    pub agreement: Account<'info, AgreementAccount>,
    #[account(
        mut,
        seeds = [
            SEED_RECEIPT,
            agreement.key().as_ref(),
            &receipt.nonce_snapshot.to_le_bytes(),
        ],
        bump = receipt.bump,
        constraint = receipt.koperasi == koperasi.key() @ PanenError::UnauthorizedKoperasi,
        constraint = (
            receipt.status == ReceiptStatus::PendingMillSign ||
            receipt.status == ReceiptStatus::ReadyToAdvance
        ) @ PanenError::ReceiptNotCloseable,
        constraint = receipt.status != ReceiptStatus::Cancelled @ PanenError::ReceiptAlreadyCancelled,
    )]
    pub receipt: Account<'info, DeliveryReceipt>,
}

#[derive(Accounts)]
pub struct MillConfirmCancel<'info> {
    pub mill: Signer<'info>,
    #[account(
        seeds = [SEED_AGREEMENT, mill.key().as_ref(), agreement.koperasi.as_ref()],
        bump = agreement.bump,
        constraint = agreement.mill == mill.key() @ PanenError::UnauthorizedMill,
    )]
    pub agreement: Account<'info, AgreementAccount>,
    #[account(
        mut,
        seeds = [
            SEED_RECEIPT,
            agreement.key().as_ref(),
            &receipt.nonce_snapshot.to_le_bytes(),
        ],
        bump = receipt.bump,
        constraint = receipt.agreement == agreement.key() @ PanenError::UnauthorizedMill,
        constraint = receipt.cancel_requested_kop         @ PanenError::CancellationRequiresBothParties,
        close = koperasi_refund,
    )]
    pub receipt: Account<'info, DeliveryReceipt>,
    /// CHECK: koperasi menerima rent refund
    #[account(
        mut,
        constraint = koperasi_refund.key() == receipt.koperasi @ PanenError::UnauthorizedKoperasi,
    )]
    pub koperasi_refund: SystemAccount<'info>,
}

/// create_advance: rate_oracle divalidasi lewat pool.oracle_authority()
/// rate_oracle divalidasi lewat pool.oracle_authority — mencegah oracle injection.
/// Seeds: [rate_oracle, oracle_authority] — oracle_authority dari pool._reserved
/// Ini memungkinkan oracle authority terpisah dari pool authority by design.
#[derive(Accounts)]
pub struct CreateAdvance<'info> {
    #[account(mut)]
    pub koperasi: Signer<'info>,
    #[account(
        seeds = [SEED_AGREEMENT, agreement.mill.as_ref(), koperasi.key().as_ref()],
        bump = agreement.bump,
        constraint = agreement.active                      @ PanenError::AgreementInactive,
        constraint = agreement.koperasi == koperasi.key() @ PanenError::UnauthorizedKoperasi,
    )]
    pub agreement: Box<Account<'info, AgreementAccount>>,
    #[account(
        mut,
        seeds = [
            SEED_RECEIPT,
            agreement.key().as_ref(),
            &receipt.nonce_snapshot.to_le_bytes(),
        ],
        bump = receipt.bump,
        constraint = receipt.agreement == agreement.key()            @ PanenError::UnauthorizedKoperasi,
        constraint = receipt.mill_signed                             @ PanenError::ReceiptNotMillSigned,
        constraint = receipt.status == ReceiptStatus::ReadyToAdvance @ PanenError::ReceiptNotReadyToAdvance,
    )]
    pub receipt: Box<Account<'info, DeliveryReceipt>>,
    #[account(mut, has_one = vault @ PanenError::InsufficientPoolFunds)]
    pub pool: Box<Account<'info, AdvancePool>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = koperasi_ata.owner == koperasi.key()  @ PanenError::InvalidKoperasiAta,
        constraint = koperasi_ata.mint  == pool.mint        @ PanenError::InvalidKoperasiAta,
        constraint = koperasi_ata.key() != vault.key()      @ PanenError::KoperasiAtaCannotBeVault,
    )]
    pub koperasi_ata: Box<Account<'info, TokenAccount>>,
    #[account(
        init, payer = koperasi, space = KoperasiAdvance::LEN,
        seeds = [SEED_ADVANCE, receipt.key().as_ref()],
        bump,
    )]
    pub advance: Box<Account<'info, KoperasiAdvance>>,
    /// Rate oracle validated via pool.oracle_authority — prevents oracle injection.
    /// Seeds: [rate_oracle, pool.oracle_authority()] — authority dari pool, bukan self-ref
    /// Constraint: rate_oracle.authority == pool.oracle_authority() — mencegah oracle injection
    #[account(
        seeds = [SEED_RATE_ORACLE, pool.oracle_authority.as_ref()],
        bump = rate_oracle.bump,
        constraint = rate_oracle.authority == pool.oracle_authority
            @ PanenError::OracleAuthorityMismatch,
        constraint = rate_oracle.is_active @ PanenError::OracleNotActive,
    )]
    pub rate_oracle: Box<Account<'info, RateOracle>>,
    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleAdvance<'info> {
    #[account(mut)]
    pub koperasi: Signer<'info>,
    #[account(
        mut,
        seeds = [SEED_ADVANCE, receipt.key().as_ref()],
        bump = advance.bump,
        constraint = advance.receipt == receipt.key() @ PanenError::ReceiptNotActive,
        constraint = advance.pool    == pool.key()    @ PanenError::ReceiptNotActive,
        constraint = !advance.settled                 @ PanenError::AlreadySettled,
        close = koperasi,
    )]
    pub advance: Box<Account<'info, KoperasiAdvance>>,
    #[account(
        mut,
        seeds = [
            SEED_RECEIPT,
            receipt.agreement.as_ref(),
            &receipt.nonce_snapshot.to_le_bytes(),
        ],
        bump = receipt.bump,
        constraint = receipt.koperasi == koperasi.key()               @ PanenError::UnauthorizedSettler,
        constraint = receipt.status   == ReceiptStatus::AdvanceActive @ PanenError::ReceiptNotActive,
        close = koperasi,
    )]
    pub receipt: Box<Account<'info, DeliveryReceipt>>,
    #[account(
        mut,
        has_one = vault    @ PanenError::InsufficientPoolFunds,
        has_one = treasury @ PanenError::UnauthorizedPoolAuthority,
    )]
    pub pool: Box<Account<'info, AdvancePool>>,
    #[account(
        mut,
        seeds = [SEED_VAULT, pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury.mint  == pool.mint      @ PanenError::InvalidMint,
        constraint = treasury.key() != vault.key()    @ PanenError::TreasuryCannotBeVault,
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = koperasi_ata.owner == koperasi.key()  @ PanenError::UnauthorizedSettler,
        constraint = koperasi_ata.mint  == pool.mint        @ PanenError::UnauthorizedSettler,
        constraint = koperasi_ata.key() != vault.key()      @ PanenError::CircularRepayment,
    )]
    pub koperasi_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseRejectedReceipt<'info> {
    #[account(mut)] // mut: menerima rent dari close = koperasi
    pub koperasi: Signer<'info>,
    #[account(
        mut,
        seeds = [
            SEED_RECEIPT,
            receipt.agreement.as_ref(),
            &receipt.nonce_snapshot.to_le_bytes(),
        ],
        bump = receipt.bump,
        constraint = receipt.koperasi == koperasi.key()          @ PanenError::UnauthorizedSettler,
        constraint = receipt.status   == ReceiptStatus::Rejected @ PanenError::ReceiptNotCloseable,
        close = koperasi,
    )]
    pub receipt: Account<'info, DeliveryReceipt>,
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRAM
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod panen {
    use super::*;

    /// Initialize the IDR/USDC rate oracle for the given authority.
    /// Must be called before `update_rate` or `create_advance`.
    pub fn initialize_rate_oracle(ctx: Context<InitializeRateOracle>) -> Result<()> {
        let o = &mut ctx.accounts.rate_oracle;
        o.authority    = ctx.accounts.authority.key();
        o.idr_per_usdc = FALLBACK_IDR_PER_USDC_RAW;
        o.last_updated = 0;
        o.is_active    = false;
        o.bump         = ctx.bumps.rate_oracle;
        o._reserved    = [0u8; 32];
        msg!("RateOracle: authority={}", o.authority);
        Ok(())
    }

    /// Push a new IDR/USDC exchange rate to the oracle.
    /// Rate must be within [100_000_000, 1_000_000_000] (10,000–100,000 IDR/USDC × 10_000).
    /// Only callable by the oracle authority.
    pub fn update_rate(ctx: Context<UpdateRate>, idr_per_usdc: u64) -> Result<()> {
        require!(
            idr_per_usdc >= RATE_MIN_RAW && idr_per_usdc <= RATE_MAX_RAW,
            PanenError::OracleZeroRate
        );
        let clock = Clock::get()?;
        let o     = &mut ctx.accounts.rate_oracle;
        o.idr_per_usdc = idr_per_usdc;
        o.last_updated = clock.unix_timestamp;
        o.is_active    = true;
        msg!("Rate: {} IDR/USDC (raw={}) ts={}",
            idr_per_usdc / 10_000, idr_per_usdc, clock.unix_timestamp);
        Ok(())
    }

    /// Koperasi proposes a financing agreement with a mill.
    /// Agreement starts inactive — mill must call `accept_agreement` to activate.
    pub fn propose_agreement(
        ctx: Context<ProposeAgreement>,
        proposed_mill: Pubkey,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let a     = &mut ctx.accounts.agreement;
        a.mill          = proposed_mill;
        a.koperasi      = ctx.accounts.koperasi.key();
        a.active        = false;
        a.created_at    = clock.unix_timestamp;
        a.receipt_nonce = 0;
        a.bump          = ctx.bumps.agreement;
        a._reserved     = [0u8; 64];
        msg!("Agreement proposed: mill={} koperasi={}", a.mill, a.koperasi);
        Ok(())
    }

    /// Cancel a pending agreement proposal before the mill accepts.
    /// Closes the account and returns rent to koperasi.
    pub fn cancel_proposal(ctx: Context<CancelProposal>) -> Result<()> {
        msg!("Proposal cancelled: mill={} koperasi={}",
            ctx.accounts.agreement.mill, ctx.accounts.agreement.koperasi);
        Ok(())
    }

    /// Mill accepts the agreement, setting it active.
    /// Once active, delivery receipts can be submitted.
    pub fn accept_agreement(ctx: Context<AcceptAgreement>) -> Result<()> {
        ctx.accounts.agreement.active = true;
        msg!("Agreement accepted: mill={} koperasi={}",
            ctx.accounts.agreement.mill, ctx.accounts.agreement.koperasi);
        Ok(())
    }

    /// Deactivate and close an agreement.
    /// Can be called by either koperasi or mill.
    pub fn deactivate_agreement(ctx: Context<DeactivateAgreement>) -> Result<()> {
        msg!("Agreement closed: mill={} koperasi={} receipts={}",
            ctx.accounts.agreement.mill,
            ctx.accounts.agreement.koperasi,
            ctx.accounts.agreement.receipt_nonce);
        Ok(())
    }

    /// Initialize pool. oracle_authority adalah keypair yang boleh push rate —
    /// bisa sama atau berbeda dengan pool authority.
    /// Update the oracle authority stored in pool.
    /// Dipanggil pool authority kapanpun, termasuk setelah upgrade dari pool lama.
    /// Set or update the oracle authority. Call after initialize_pool to change.
    /// This binding is required for `create_advance` to validate the rate oracle.
    /// Call this once after `initialize_pool`, or after upgrading from an older program version.
    pub fn set_oracle_authority(
        ctx: Context<SetOracleAuthority>,
        oracle_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.pool.oracle_authority = oracle_authority;
        msg!("oracle_authority set: pool={} oracle={}",
            ctx.accounts.pool.key(), oracle_authority);
        Ok(())
    }

    /// Initialize the USDC advance pool.
    /// oracle_authority defaults to pool authority — use `set_oracle_authority` to change.
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        oracle_authority: Pubkey,
    ) -> Result<()> {
        // oracle_authority diisi default (pool.authority) saat init.
        // Gunakan set_oracle_authority untuk menggantinya setelah init.
        let p = &mut ctx.accounts.pool;
        p.authority        = ctx.accounts.authority.key();
        p.mint             = ctx.accounts.mint.key();
        p.vault            = ctx.accounts.vault.key();
        p.lp_yield_bps     = LP_YIELD_BPS as u16;
        p.protocol_fee_bps = PROTOCOL_FEE_BPS as u16;
        p.treasury         = ctx.accounts.treasury.key();
        p.total_deposited  = 0;
        p.total_advanced   = 0;
        p.bump             = ctx.bumps.pool;
        p.vault_bump       = ctx.bumps.vault;
        p.oracle_authority = oracle_authority;
        p._reserved        = [0u8; 32];
        // Assign oracle_authority
        p.oracle_authority = oracle_authority;
        msg!("Pool: authority={} vault={} treasury={} oracle_authority={}",
            p.authority, p.vault, p.treasury, oracle_authority);
        msg!("Pool: fee={}bps yield={}bps", p.protocol_fee_bps, p.lp_yield_bps);
        Ok(())
    }

    /// Deposit USDC into the advance pool vault.
    /// Only callable by pool authority.
    pub fn deposit_pool(ctx: Context<DepositPool>, amount: u64) -> Result<()> {
        require!(amount > 0, PanenError::ZeroAdvanceAmount);
        require!(
            ctx.accounts.authority_ata.amount >= amount,
            PanenError::InsufficientPoolFunds
        );
        token::transfer(
            CpiContext::new(Token::id(), Transfer {
                from:      ctx.accounts.authority_ata.to_account_info(),
                to:        ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            }),
            amount,
        )?;
        let p = &mut ctx.accounts.pool;
        p.total_deposited = p.total_deposited
            .checked_add(amount)
            .ok_or(PanenError::ArithmeticOverflow)?;
        msg!("Deposit: +{} total_deposited={}", amount, p.total_deposited);
        Ok(())
    }

    /// Withdraw available (non-advanced) USDC from vault.
    /// Only callable by pool authority. Cannot withdraw funds currently advanced.
    pub fn withdraw_pool(ctx: Context<WithdrawPool>, amount: u64) -> Result<()> {
        require!(amount > 0, PanenError::ZeroWithdrawAmount);
        let available = ctx.accounts.pool.available(ctx.accounts.vault.amount);
        require!(amount <= available, PanenError::WithdrawExceedsAvailable);

        let pool_authority = ctx.accounts.pool.authority;
        let pool_bump      = ctx.accounts.pool.bump;
        let seeds: &[&[&[u8]]] = &[&[SEED_POOL, pool_authority.as_ref(), &[pool_bump]]];

        token::transfer(
            CpiContext::new_with_signer(Token::id(), Transfer {
                from:      ctx.accounts.vault.to_account_info(),
                to:        ctx.accounts.authority_ata.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            }, seeds),
            amount,
        )?;

        let p = &mut ctx.accounts.pool;
        p.total_deposited = p.total_deposited.saturating_sub(amount);
        msg!("Withdraw: -{} remaining={} outstanding={}",
            amount, p.total_deposited, p.total_advanced);
        Ok(())
    }

    /// Koperasi submits a TBS delivery receipt.
    /// If fraud_score >= FRAUD_REJECT_THRESHOLD (70), receipt is rejected immediately.
    /// Otherwise status = PendingMillSign.
    pub fn submit_delivery_receipt(
        ctx: Context<SubmitDeliveryReceipt>,
        params: SubmitReceiptParams,
    ) -> Result<()> {
        require!(params.weight_kg > 0,    PanenError::ZeroWeight);
        require!(params.price_per_kg > 0, PanenError::ZeroPrice);
        let expected = params.weight_kg
            .checked_mul(params.price_per_kg)
            .ok_or(PanenError::ArithmeticOverflow)?;
        require!(params.invoice_value_idr == expected, PanenError::InvoiceValueMismatch);
        require!(
            params.gps_lat >= GPS_LAT_MIN && params.gps_lat <= GPS_LAT_MAX,
            PanenError::InvalidGpsCoordinates
        );
        require!(
            params.gps_lon >= GPS_LON_MIN && params.gps_lon <= GPS_LON_MAX,
            PanenError::InvalidGpsCoordinates
        );

        let status = if params.fraud_score >= FRAUD_REJECT_THRESHOLD {
            ReceiptStatus::Rejected
        } else {
            ReceiptStatus::PendingMillSign
        };

        let clock = Clock::get()?;
        let nonce = ctx.accounts.agreement.receipt_nonce;
        let r     = &mut ctx.accounts.receipt;
        r.agreement            = ctx.accounts.agreement.key();
        r.koperasi             = ctx.accounts.koperasi.key();
        r.weight_kg            = params.weight_kg;
        r.price_per_kg         = params.price_per_kg;
        r.invoice_value_idr    = params.invoice_value_idr;
        r.nonce_snapshot       = nonce;
        r.invoice_hash         = params.invoice_hash;
        r.gps_lat              = params.gps_lat;
        r.gps_lon              = params.gps_lon;
        r.fraud_score          = params.fraud_score;
        r.mill_signed          = false;
        r.created_at           = clock.unix_timestamp;
        r.status               = status.clone();
        r.bump                 = ctx.bumps.receipt;
        r.cancel_requested_kop = false;
        r._reserved            = [0u8; 64];
        ctx.accounts.agreement.receipt_nonce = nonce
            .checked_add(1)
            .ok_or(PanenError::ArithmeticOverflow)?;
        msg!("Receipt[{}]: koperasi={} {}kg Rp{}/kg idr={} score={} {:?}",
            nonce, r.koperasi, r.weight_kg, r.price_per_kg,
            r.invoice_value_idr, r.fraud_score, r.status);
        Ok(())
    }

    /// Mill co-signs the receipt to confirm TBS was received.
    /// Changes status: PendingMillSign → ReadyToAdvance.
    pub fn mill_cosign_receipt(ctx: Context<MillCosignReceipt>) -> Result<()> {
        let r = &mut ctx.accounts.receipt;
        r.mill_signed = true;
        r.status      = ReceiptStatus::ReadyToAdvance;
        msg!("MillCosign[{}]: mill={} → ReadyToAdvance",
            r.nonce_snapshot, ctx.accounts.mill.key());
        Ok(())
    }

    /// Koperasi requests mutual cancellation of a receipt.
    /// Sets cancel_requested_kop = true. Mill must call `mill_confirm_cancel` to finalize.
    pub fn request_cancel_receipt(ctx: Context<RequestCancelReceipt>) -> Result<()> {
        ctx.accounts.receipt.cancel_requested_kop = true;
        msg!("Cancel requested[{}]: koperasi={} status={:?}",
            ctx.accounts.receipt.nonce_snapshot,
            ctx.accounts.receipt.koperasi,
            ctx.accounts.receipt.status);
        Ok(())
    }

    /// Mill confirms receipt cancellation.
    /// Closes the receipt account and returns rent to koperasi.
    pub fn mill_confirm_cancel(ctx: Context<MillConfirmCancel>) -> Result<()> {
        msg!("Receipt cancelled[{}]: mill={} koperasi={} (mutual)",
            ctx.accounts.receipt.nonce_snapshot,
            ctx.accounts.agreement.mill,
            ctx.accounts.receipt.koperasi);
        Ok(())
    }

    /// Disburse 80% of invoice value in USDC to koperasi.
    /// Validates rate oracle via pool.oracle_authority — prevents oracle injection.
    /// Uses fallback rate (FALLBACK_IDR_PER_USDC_RAW) if oracle is stale (> 48 hours).
    pub fn create_advance(ctx: Context<CreateAdvance>) -> Result<()> {
        let clock = Clock::get()?;
        let oracle = &ctx.accounts.rate_oracle;
        let age    = clock.unix_timestamp.saturating_sub(oracle.last_updated);
        let idr_per_usdc_raw = if age > ORACLE_MAX_STALENESS_SECS {
            msg!("Oracle stale ({}s) → fallback {} IDR/USDC",
                age, FALLBACK_IDR_PER_USDC_RAW / 10_000);
            FALLBACK_IDR_PER_USDC_RAW
        } else {
            msg!("Oracle: {} IDR/USDC age={}s", oracle.idr_per_usdc / 10_000, age);
            oracle.idr_per_usdc
        };

        let invoice_idr = ctx.accounts.receipt.invoice_value_idr;
        let usdc_invoice = (invoice_idr as u128)
            .checked_mul(USDC_MULTIPLIER as u128)
            .ok_or(PanenError::ArithmeticOverflow)?
            .checked_mul(10_000u128)
            .ok_or(PanenError::ArithmeticOverflow)?
            .checked_div(idr_per_usdc_raw as u128)
            .ok_or(PanenError::ArithmeticOverflow)?;
        let advance_amount = usdc_invoice
            .checked_mul(ADVANCE_RATE_BPS as u128)
            .ok_or(PanenError::ArithmeticOverflow)?
            .checked_div(10_000u128)
            .ok_or(PanenError::ArithmeticOverflow)? as u64;

        require!(advance_amount > 0, PanenError::ZeroAdvanceAmount);
        let available = ctx.accounts.pool.available(ctx.accounts.vault.amount);
        require!(available >= advance_amount, PanenError::InsufficientPoolFunds);

        let pool_authority = ctx.accounts.pool.authority;
        let pool_bump      = ctx.accounts.pool.bump;
        let seeds: &[&[&[u8]]] = &[&[SEED_POOL, pool_authority.as_ref(), &[pool_bump]]];

        token::transfer(
            CpiContext::new_with_signer(Token::id(), Transfer {
                from:      ctx.accounts.vault.to_account_info(),
                to:        ctx.accounts.koperasi_ata.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            }, seeds),
            advance_amount,
        )?;

        let adv = &mut ctx.accounts.advance;
        adv.receipt          = ctx.accounts.receipt.key();
        adv.pool             = ctx.accounts.pool.key();
        adv.koperasi         = ctx.accounts.koperasi.key();
        adv.advance_amount   = advance_amount;
        adv.disbursed_at     = clock.unix_timestamp;
        adv.due_at           = clock.unix_timestamp
            .checked_add(SETTLEMENT_WINDOW_SECS)
            .ok_or(PanenError::ArithmeticOverflow)?;
        adv.idr_per_usdc_raw = idr_per_usdc_raw;
        adv.settled          = false;
        adv.settled_at       = 0;
        adv.bump             = ctx.bumps.advance;
        adv._reserved        = [0u8; 32];

        ctx.accounts.receipt.status  = ReceiptStatus::AdvanceActive;
        ctx.accounts.pool.total_advanced = ctx.accounts.pool.total_advanced
            .checked_add(advance_amount)
            .ok_or(PanenError::ArithmeticOverflow)?;

        msg!("Advance: koperasi={} amount={} due={} rate={}IDR/USDC",
            adv.koperasi, advance_amount, adv.due_at, idr_per_usdc_raw / 10_000);
        Ok(())
    }

    /// Koperasi repays the advance + 3.5% protocol fee.
    /// Closes both KoperasiAdvance and DeliveryReceipt accounts (rent → koperasi).
    /// Fee split: 3.0% LP yield → vault, 0.5% protocol fee → treasury.
    pub fn settle_advance(ctx: Context<SettleAdvance>) -> Result<()> {
        let clock          = Clock::get()?;
        let advance_amount = ctx.accounts.advance.advance_amount;

        let service_fee = (advance_amount as u128)
            .checked_mul(SERVICE_FEE_BPS)
            .ok_or(PanenError::ArithmeticOverflow)?
            .checked_div(10_000u128)
            .ok_or(PanenError::ArithmeticOverflow)? as u64;
        let protocol_fee = (advance_amount as u128)
            .checked_mul(PROTOCOL_FEE_BPS)
            .ok_or(PanenError::ArithmeticOverflow)?
            .checked_div(10_000u128)
            .ok_or(PanenError::ArithmeticOverflow)? as u64;

        let lp_yield        = service_fee.saturating_sub(protocol_fee);
        let vault_repayment = advance_amount
            .checked_add(lp_yield)
            .ok_or(PanenError::ArithmeticOverflow)?;
        let total_repayment = advance_amount
            .checked_add(service_fee)
            .ok_or(PanenError::ArithmeticOverflow)?;

        require!(
            ctx.accounts.koperasi_ata.amount >= total_repayment,
            PanenError::InsufficientRepaymentBalance
        );

        token::transfer(
            CpiContext::new(Token::id(), Transfer {
                from:      ctx.accounts.koperasi_ata.to_account_info(),
                to:        ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.koperasi.to_account_info(),
            }),
            vault_repayment,
        )?;

        if protocol_fee > 0 {
            token::transfer(
                CpiContext::new(Token::id(), Transfer {
                    from:      ctx.accounts.koperasi_ata.to_account_info(),
                    to:        ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.koperasi.to_account_info(),
                }),
                protocol_fee,
            )?;
        }

        ctx.accounts.advance.settled    = true;
        ctx.accounts.advance.settled_at = clock.unix_timestamp;
        ctx.accounts.receipt.status     = ReceiptStatus::Settled;

        let p = &mut ctx.accounts.pool;
        p.total_advanced  = p.total_advanced.saturating_sub(advance_amount);
        p.total_deposited = p.total_deposited
            .checked_add(lp_yield)
            .ok_or(PanenError::ArithmeticOverflow)?;

        msg!("Settled: koperasi={} advance={} repaid={} yield={} fee={} ts={}",
            ctx.accounts.advance.koperasi, advance_amount,
            total_repayment, lp_yield, protocol_fee, clock.unix_timestamp);
        Ok(())
    }

    /// Close a rejected receipt account and return rent to koperasi.
    pub fn close_rejected_receipt(ctx: Context<CloseRejectedReceipt>) -> Result<()> {
        msg!("Rejected receipt closed[{}]: koperasi={}",
            ctx.accounts.receipt.nonce_snapshot,
            ctx.accounts.receipt.koperasi);
        Ok(())
    }
}