import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SEED_AGREEMENT, SEED_RECEIPT,
  SEED_ADVANCE,   SEED_VAULT,
  SEED_RATE_ORACLE, SEED_POOL,
} from "../config/constants";

export function deriveAgreement(mill: PublicKey, koperasi: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEED_AGREEMENT, mill.toBytes(), koperasi.toBytes()],
    PROGRAM_ID
  );
}

export function deriveReceipt(agreement: PublicKey, nonce: bigint) {
  // Nonce sebagai little-endian 8 bytes — manual tanpa Buffer
  const nonceBuf = new Uint8Array(8);
  let n = nonce;
  for (let i = 0; i < 8; i++) {
    nonceBuf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return PublicKey.findProgramAddressSync(
    [SEED_RECEIPT, agreement.toBytes(), nonceBuf],
    PROGRAM_ID
  );
}

export function deriveAdvance(receipt: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEED_ADVANCE, receipt.toBytes()],
    PROGRAM_ID
  );
}

export function deriveVault(pool: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEED_VAULT, pool.toBytes()],
    PROGRAM_ID
  );
}

export function deriveRateOracle(oracleAuthority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEED_RATE_ORACLE, oracleAuthority.toBytes()],
    PROGRAM_ID
  );
}

export function derivePool(authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [SEED_POOL, authority.toBytes()],
    PROGRAM_ID
  );
}
