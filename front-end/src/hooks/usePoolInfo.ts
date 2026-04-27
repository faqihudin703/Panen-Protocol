/**
 * usePoolInfo.ts — Baca pool account on-chain, resolve oracle + treasury
 *
 * Pool._reserved[0..32] = oracle_authority pubkey
 * Oracle PDA = findPDA([rate_oracle, oracle_authority])
 * Treasury = pool.treasury field
 *
 * Di-cache dan di-refresh setiap 60 detik.
 * Dipakai oleh useAdvanceFlow, useChainStats, App.tsx
 */
import { useEffect, useState, useCallback } from "react"
import { Connection, PublicKey }             from "@solana/web3.js"
import { POOL_PUBKEY, SEED_RATE_ORACLE, PROGRAM_ID, RPC_URL } from "../config/constants"

export interface PoolInfo {
    poolPubkey:       PublicKey
    vaultPubkey:      PublicKey
    treasuryPubkey:   PublicKey
    oraclePubkey:     PublicKey   // rate_oracle PDA — derived dari oracle_authority
    oracleAuthority:  PublicKey   // dari pool._reserved[0..32]
    totalDeposited:   bigint
    totalAdvanced:    bigint
    lpYieldBps:       number
    protocolFeeBps:   number
    loaded:           boolean
    error:            string | null
}

// AdvancePool layout:
//   8  disc
//   32 authority
//   32 mint
//   32 vault
//   2  lp_yield_bps
//   2  protocol_fee_bps
//   32 treasury
//   8  total_deposited
//   8  total_advanced
//   1  bump
//   1  vault_bump
//   64 _reserved  ← [0..32] = oracle_authority
function parsePoolAccount(data: Uint8Array): {
    vault:           PublicKey
    treasury:        PublicKey
    totalDeposited:  bigint
    totalAdvanced:   bigint
    lpYieldBps:      number
    protocolFeeBps:  number
    oracleAuthority: PublicKey
} {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let off = 8 // skip discriminator

    const authority      = new PublicKey(data.slice(off, off + 32)); off += 32
    const mint           = new PublicKey(data.slice(off, off + 32)); off += 32
    const vault          = new PublicKey(data.slice(off, off + 32)); off += 32
    const lpYieldBps     = view.getUint16(off, true);                off += 2
    const protocolFeeBps = view.getUint16(off, true);                off += 2
    const treasury       = new PublicKey(data.slice(off, off + 32)); off += 32
    const totalDeposited = view.getBigUint64(off, true);             off += 8
    const totalAdvanced  = view.getBigUint64(off, true);             off += 8
    off += 2 // bump + vault_bump

    // _reserved[0..32] = oracle_authority
    const oracleAuthority = new PublicKey(data.slice(off, off + 32))

    return { vault, treasury, totalDeposited, totalAdvanced,
             lpYieldBps, protocolFeeBps, oracleAuthority }
}

const DEFAULT_INFO: PoolInfo = {
    poolPubkey:      POOL_PUBKEY,
    vaultPubkey:     PublicKey.default,
    treasuryPubkey:  PublicKey.default,
    oraclePubkey:    PublicKey.default,
    oracleAuthority: PublicKey.default,
    totalDeposited:  0n,
    totalAdvanced:   0n,
    lpYieldBps:      300,
    protocolFeeBps:  50,
    loaded:          false,
    error:           null,
}

// Singleton cache — shared across all hook instances
let _cache: PoolInfo | null = null
let _lastFetch = 0
const CACHE_TTL = 60_000 // 60 detik

async function fetchPoolInfo(): Promise<PoolInfo> {
    const now = Date.now()
    if (_cache && now - _lastFetch < CACHE_TTL) return _cache

    const conn = new Connection(RPC_URL, "confirmed")
    const accountInfo = await conn.getAccountInfo(POOL_PUBKEY)
    if (!accountInfo) throw new Error(`Pool account tidak ditemukan: ${POOL_PUBKEY.toBase58()}`)

    const parsed = parsePoolAccount(new Uint8Array(accountInfo.data))

    // Derive oracle PDA dari oracle_authority
    const [oraclePda] = PublicKey.findProgramAddressSync(
        [SEED_RATE_ORACLE, parsed.oracleAuthority.toBytes()],
        PROGRAM_ID
    )

    const info: PoolInfo = {
        poolPubkey:      POOL_PUBKEY,
        vaultPubkey:     parsed.vault,
        treasuryPubkey:  parsed.treasury,
        oraclePubkey:    oraclePda,
        oracleAuthority: parsed.oracleAuthority,
        totalDeposited:  parsed.totalDeposited,
        totalAdvanced:   parsed.totalAdvanced,
        lpYieldBps:      parsed.lpYieldBps,
        protocolFeeBps:  parsed.protocolFeeBps,
        loaded:          true,
        error:           null,
    }

    _cache = info
    _lastFetch = now
    return info
}

// Invalidate cache (dipanggil setelah TX yang ubah pool state)
export function invalidatePoolCache() {
    _cache = null
    _lastFetch = 0
}

// Hook version — untuk React components
export function usePoolInfo(): PoolInfo {
    const [info, setInfo] = useState<PoolInfo>(DEFAULT_INFO)

    useEffect(() => {
        let cancelled = false
        fetchPoolInfo()
            .then(i  => { if (!cancelled) setInfo(i) })
            .catch(e => { if (!cancelled) setInfo(s => ({
                ...s, loaded: true, error: e.message
            }))})

        const interval = setInterval(() => {
            invalidatePoolCache()
            fetchPoolInfo()
                .then(i  => { if (!cancelled) setInfo(i) })
                .catch(() => {})
        }, 60_000)

        return () => { cancelled = true; clearInterval(interval) }
    }, [])

    return info
}

// Imperative version — untuk hooks lain yang butuh pool info satu kali
export async function getPoolInfo(): Promise<PoolInfo> {
    return fetchPoolInfo()
}