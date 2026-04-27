/**
 * useChainStats.ts — Baca stats pool + oracle dari on-chain
 * Pakai usePoolInfo untuk pool data, lalu fetch oracle secara terpisah
 */
import { useEffect, useState } from "react"
import { Connection }          from "@solana/web3.js"
import { usePoolInfo }         from "./usePoolInfo"
import { PROGRAM_ID, RPC_URL, CLUSTER } from "../config/constants"

// RateOracle layout:
//   8  disc
//   32 authority
//   8  idr_per_usdc
//   8  last_updated
//   1  is_active
//   1  bump
//   32 _reserved
function parseRateOracle(data: Uint8Array) {
    const view = new DataView(data.buffer, data.byteOffset)
    const off   = 8 + 32 // skip disc + authority
    return {
        idrPerUsdc:  view.getBigUint64(off, true),
        lastUpdated: Number(view.getBigInt64(off + 8, true)),
        isActive:    data[off + 16] === 1,
    }
}

// SPL Token Account: amount at offset 64
function parseTokenAmount(data: Uint8Array): bigint {
    return new DataView(data.buffer, data.byteOffset).getBigUint64(64, true)
}

export interface ChainStats {
    programAddress:  string
    poolBalanceUsdc: number
    oracleRateRaw:   bigint
    oracleActive:    boolean
    oracleUpdatedAt: number
    loading:         boolean
    error:           string | null
}

export function useChainStats(): ChainStats {
    const pool = usePoolInfo()

    const [stats, setStats] = useState<ChainStats>({
        programAddress:  PROGRAM_ID.toBase58(),
        poolBalanceUsdc: 0,
        oracleRateRaw:   0n,
        oracleActive:    false,
        oracleUpdatedAt: 0,
        loading:         true,
        error:           null,
    })

    useEffect(() => {
        if (!pool.loaded) return
        if (pool.error) {
            setStats(s => ({ ...s, loading: false, error: pool.error }))
            return
        }

        let cancelled = false
        const conn = new Connection(RPC_URL, "confirmed")

        async function fetch() {
            try {
                // Fetch vault + oracle secara paralel
                const [vaultInfo, oracleInfo] = await conn.getMultipleAccountsInfo([
                    pool.vaultPubkey,
                    pool.oraclePubkey,
                ])

                if (!vaultInfo)  throw new Error(`Vault tidak ditemukan: ${pool.vaultPubkey.toBase58()}`)
                if (!oracleInfo) throw new Error(`Oracle tidak ditemukan: ${pool.oraclePubkey.toBase58()}`)

                const vaultBalance = parseTokenAmount(new Uint8Array(vaultInfo.data))
                const oracle       = parseRateOracle(new Uint8Array(oracleInfo.data))

                if (!cancelled) setStats({
                    programAddress:  PROGRAM_ID.toBase58(),
                    poolBalanceUsdc: Number(vaultBalance) / 1_000_000,
                    oracleRateRaw:   oracle.idrPerUsdc,
                    oracleActive:    oracle.isActive,
                    oracleUpdatedAt: oracle.lastUpdated,
                    loading:         false,
                    error:           null,
                })
            } catch (e: any) {
                if (!cancelled)
                    setStats(s => ({ ...s, loading: false, error: e.message }))
            }
        }

        fetch()
        const interval = setInterval(fetch, 30_000)
        return () => { cancelled = true; clearInterval(interval) }

    }, [pool.loaded, pool.vaultPubkey.toBase58(), pool.oraclePubkey.toBase58()])

    return stats
}