export function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function formatUSDC(lamports: number): string {
  return (lamports / 1_000_000).toFixed(2) + " USDC";
}

// IDR → USDC menggunakan rate dari oracle (raw = rate × 10_000)
export function idrToUsdc(idrAmount: number, rateRaw: number): number {
  if (rateRaw === 0) return 0;
  return (idrAmount * 1_000_000 * 10_000) / rateRaw; // dalam lamports USDC
}

export function calcAdvance(invoiceIdr: number, rateRaw: number): number {
  const usdcLamports = idrToUsdc(invoiceIdr, rateRaw);
  return Math.floor(usdcLamports * 0.80); // 80% advance rate
}
